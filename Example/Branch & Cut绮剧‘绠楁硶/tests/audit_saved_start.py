#!/usr/bin/env python3
"""Audit raw data and every actual COPT MIP-start variable/row WITHOUT solving.

This intercepts solve() and the native MIP-start loader in a test fixture only.
The normal experimental entry point never uses this interception.
"""
from __future__ import annotations

import argparse
import contextlib
import inspect
import io
import json
import math
from pathlib import Path
import sys
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import coptpy as cp
import common
import joint_copt_from_two_step as entry
import joint_copt_undirected as core
from check_joint_results import read_json,validate_result
from undirected_routing import audit_raw_data,symmetric_costs


class ModelBuilt(Exception):pass


class ModelProxy:
    def __init__(self,model,owner):self.model=model;self.owner=owner
    def __getattr__(self,name):return getattr(self.model,name)
    def setMipStart(self,variables,values):
        self.owner.start={v.name:float(value) for v,value in zip(variables,values)}
        if len(self.owner.start)!=len(variables):raise AssertionError('Duplicate start variables')
    def loadMipStart(self):self.owner.loaded=True
    def solve(self):
        self.owner.frame=inspect.currentframe().f_back
        raise ModelBuilt()
    def dispose(self):pass


class EnvironmentProxy:
    def __init__(self,env):
        self.env=env;self.model=None;self.frame=None;self.start={};self.loaded=False
    def createModel(self,name):
        self.model=self.env.createModel(name)
        return ModelProxy(self.model,self)
    def dispose(self):pass


@contextlib.contextmanager
def captured_model(pre,candidate,denominator):
    config=cp.EnvrConfig();config.set('nobanner','1')
    env=cp.Envr(config);proxy=EnvironmentProxy(env)
    try:
        with mock.patch.object(cp,'Envr',return_value=proxy),contextlib.redirect_stdout(io.StringIO()):
            try:
                core.solve_joint(pre,energy_norm_denom=denominator,initial_solution=candidate,
                                 use_two_step_start=False,log_output=False)
            except ModelBuilt:pass
            else:raise AssertionError('Model was not intercepted')
        yield proxy
    finally:
        if proxy.frame is not None:proxy.frame.clear();proxy.frame=None
        if proxy.model is not None:proxy.model.dispose()
        env.dispose()


def signature(model):
    variables={v.name:(v.lb,v.ub,v.vtype,v.getInfo('Obj')) for v in model.getVars()}
    rows={}
    for constraint in model.getConstrs():
        row=model.getRow(constraint)
        coefficients={}
        for position in range(row.getSize()):
            name=row.getVar(position).name
            coefficients[name]=coefficients.get(name,0.)+row.getCoeff(position)
        rows[constraint.name]=(constraint.lb,constraint.ub,row.getConstant(),coefficients)
    return variables,rows


def audit(data_path,seed_path):
    data,data_hash=read_json(Path(data_path));candidate,seed_hash=read_json(Path(seed_path))
    audit_raw_data(data)
    with contextlib.redirect_stdout(io.StringIO()):pre=common.preprocess(data)
    denominator=common.nn_tour_energy(pre)
    _,recorded=entry.prepare_start(pre,candidate,denominator,data_hash)
    raw=dict(candidate,method='joint',obj_bound=None,mip_gap=None,
             status='FEASIBLE_TWO_STEP_START',solver='feasibility_check_only')
    raw.pop('is_optimal',None)
    check=validate_result(data,raw)
    if not check['passed']:raise AssertionError(check['errors'])
    costs,routing=symmetric_costs(pre)
    # Build the ACTUAL production models with and without the external seed.
    # Neither build performs optimisation or requires a large-instance licence.
    with captured_model(pre,None,denominator) as cold:
        cold_signature=signature(cold.model)
    with captured_model(pre,candidate,denominator) as warm:
        warm_signature=signature(warm.model)
        if cold_signature!=warm_signature:raise AssertionError('Warm start changed model coefficients/bounds')
        variables,rows=warm_signature
        if not warm.loaded or set(warm.start)!=set(variables):raise AssertionError('Incomplete start')
        for name,(lb,ub,kind,_) in variables.items():
            value=warm.start[name]
            if not lb-1e-8<=value<=ub+1e-8:raise AssertionError(f'Bound violated: {name}')
            if kind!='C' and abs(value-round(value))>1e-8:raise AssertionError(f'Integrality: {name}')
        max_violation=0.
        for name,(lb,ub,constant,coefficients) in rows.items():
            value=constant+math.fsum(coefficient*warm.start[var] for var,coefficient in coefficients.items())
            violation=max(0.,lb-value,value-ub);max_violation=max(max_violation,violation)
            if violation>1e-7:raise AssertionError(f'Row violated: {name}, {violation}')
        objective=math.fsum(v[3]*warm.start[name] for name,v in variables.items())
        if not math.isclose(objective,candidate['obj'],rel_tol=1e-8,abs_tol=1e-7):raise AssertionError('Start objective mismatch')
        # Check all possible conditional connectivity SECs implicitly: the seed
        # is a single closed simple cycle covering precisely the selected VPs.
        # Every nonempty selected subset not containing the depot crosses it >=2.
        return dict(data_file=Path(data_path).name,seed_file=Path(seed_path).name,
            data_sha256=data_hash,seed_sha256=seed_hash,
            passed=True,optimisation_performed=False,
            raw_data_check=check,recorded_two_step_runtime=recorded,
            raw_viewpoint_count=pre['n_vp'],raw_sample_count=pre['n_sp'],
            raw_hemisphere_count=pre['n_hp'],raw_photo_pair_count=pre['n_pairs'],
            model_variables=len(variables),model_rows=len(rows),mapped_start_variables=len(warm.start),
            every_bound_and_integrality_checked=True,every_static_model_row_checked=True,
            max_static_row_violation=max_violation,
            start_is_single_depot_cycle=True,
            cold_and_warm_model_coefficients_and_bounds_identical=True,
            objective_from_model_coefficients=objective,energy_norm_denom=denominator,
            native_mip_start_load_performed=False,
            note='Large-instance model audit only; small regression tests exercise the native MIP-start loader and solve().',
            **routing)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=ROOT/'data/Multi_1.json')
    parser.add_argument('--two-step-solution',type=Path,default=ROOT/'two_step_results/two_step_Multi_1.json')
    parser.add_argument('--report',type=Path,default=Path('saved_start_audit.json'))
    args=parser.parse_args()
    if args.report.resolve() in {args.data.resolve(),args.two_step_solution.resolve()}:
        parser.error('Report cannot overwrite an input')
    report=audit(args.data,args.two_step_solution)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')
    print(f'[AUDIT PASS] {report["model_variables"]} variables; {report["model_rows"]} rows; report={args.report}')


if __name__=='__main__':main()
