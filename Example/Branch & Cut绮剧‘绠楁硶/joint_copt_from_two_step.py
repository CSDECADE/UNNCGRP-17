#!/usr/bin/env python3
"""Unchanged undirected Branch-and-Cut, warm-started from a saved two-step plan.

runtime = saved two_step.runtime + joint_solver_runtime (COPT SolvingTime).
No internal two-step optimisation is performed by this entry point.
"""
from __future__ import annotations

import argparse
import gc
import json
import math
from pathlib import Path
import time

import common
import joint_copt_undirected as core
from check_joint_results import read_json, validate_result
from joint_mip_start import validate_initial_solution
from undirected_routing import FractionalConfig, audit_raw_data, symmetric_costs


def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f'{name} must be a finite number')
    return float(value)


def prepare_start(pre, saved, denominator, input_sha256=None):
    """Fail before solving if a supplied seed or its historical runtime is invalid."""
    if not isinstance(saved, dict) or saved.get('method') != 'two_step':
        raise ValueError('The initial solution must be a complete two_step result JSON')
    recorded_runtime = number(saved.get('runtime'), 'two_step.runtime')
    if recorded_runtime < 0:
        raise ValueError('two_step.runtime cannot be negative')
    source_hash = saved.get('input_sha256')
    if source_hash is not None and source_hash != input_sha256:
        raise ValueError('Initial-solution input_sha256 differs from the current data')
    witness = validate_initial_solution(pre, saved, denominator, common.MIN_COVER_PER_SAMPLE)
    quality = math.fsum(float(pre['gamma'][h]) for h, yes in enumerate(witness.hemisphere_covered) if yes)
    energy = math.fsum(pre['energy'][e] for e in zip(witness.tour, witness.tour[1:]))
    expected = dict(energy=energy, weighted_quality=quality, photos=len(witness.photos),
                    n_viewpoints=len(witness.visited), energy_norm_denom=denominator,
                    energy_norm=energy/denominator, quality_norm=quality/pre['total_omega'],
                    photo_norm=len(witness.photos)/pre['n_pairs'], obj=witness.objective)
    for key, value in expected.items():
        if key not in saved:
            raise ValueError(f'Initial solution is missing {key}')
        actual = number(saved[key], f'two_step.{key}')
        if not math.isclose(actual, value, rel_tol=1e-8, abs_tol=1e-7):
            raise ValueError(f'Initial-solution {key} does not match current input: {actual} vs {value}')
    for name in ['runtime_step1', 'runtime_step2']:
        if saved.get(name) is not None and number(saved[name], f'two_step.{name}') < 0:
            raise ValueError(f'{name} cannot be negative')
    if saved.get('stage1_source') == 'provided':
        raise ValueError('This two-step result reused a pre-existing first-stage selection; '
                         'its runtime omits that earlier stage. Supply a complete two-step-run result '
                         'so total exact-solve time is not understated.')
    return witness, recorded_runtime


def solve_joint(pre, two_step_result, *, energy_norm_denom=None, input_sha256=None,
                time_limit=common.TIME_LIMIT_JOINT, threads=common.COPT_THREADS,
                memory_gb=common.COPT_MEMLIMIT_MB/1024, relative_gap=None,
                absolute_gap=None, fractional_config=None, accelerate=True,
                log_output=True):
    """Change only the source of the MIP start and the requested time accounting."""
    denominator = common.nn_tour_energy(pre) if energy_norm_denom is None else energy_norm_denom
    if not math.isfinite(denominator) or denominator <= 0:
        raise ValueError('Energy normalisation must be finite and positive')
    symmetric_costs(pre)
    witness, two_step_time = prepare_start(pre, two_step_result, denominator, input_sha256)
    if not isinstance(threads, int) or isinstance(threads, bool) or threads < 1:
        raise ValueError('threads must be a positive integer')
    if not math.isfinite(memory_gb) or not 0 < memory_gb <= 1e20/1024:
        raise ValueError('Invalid memory budget')
    for name, value in [('time_limit', time_limit), ('relative_gap', relative_gap),
                        ('absolute_gap', absolute_gap)]:
        if value is not None and (not math.isfinite(value) or value < 0):
            raise ValueError(f'Invalid {name}')
    if time_limit > 1e20:
        raise ValueError('time_limit exceeds 1e20 seconds')
    original_resources = core.COPT_THREADS, core.COPT_MEMLIMIT_MB
    core.COPT_THREADS, core.COPT_MEMLIMIT_MB = threads, memory_gb*1024
    started = time.perf_counter()
    try:
        result = core.solve_joint(
            pre, energy_norm_denom=denominator, time_limit=time_limit,
            log_output=log_output, accelerate=accelerate,
            use_two_step_start=False, initial_solution=two_step_result,
            relative_gap=relative_gap, absolute_gap=absolute_gap,
            fractional_config=fractional_config,
        )
    finally:
        core.COPT_THREADS, core.COPT_MEMLIMIT_MB = original_resources
    if result.get('warm_start_status') != 'submitted':
        raise RuntimeError('Supplied two-step start was not submitted; refusing a silent cold run')
    solver_time = number(result['joint_solver_runtime'], 'joint_solver_runtime')
    if solver_time < 0:
        raise RuntimeError('Negative solver time')
    phase_wall = number(result['runtime_joint'], 'original joint phase wall runtime')
    result.update(
        runtime=two_step_time+solver_time,
        runtime_two_step=two_step_time,
        runtime_joint=solver_time,
        joint_solver_runtime=solver_time,
        runtime_joint_phase_wall=phase_wall,
        runtime_joint_call_wall=time.perf_counter()-started,
        runtime_joint_overhead=max(0., phase_wall-solver_time),
        runtime_scope='saved two_step.runtime + COPT joint SolvingTime; '
                      'reading, validation, model construction and cleanup are separate wall-clock fields',
        warm_start_source='two_step_result_file',
        warm_start_generated_in_current_run=False,
        warm_start_obj=witness.objective,
        two_step_runtime_scope=two_step_result.get('runtime_scope', 'As recorded in the supplied two-step JSON'),
        input_sha256=input_sha256,
    )
    for key in ['runtime_step1', 'runtime_step2']:
        if two_step_result.get(key) is None:
            result.pop(key, None)
        else:
            result[key] = two_step_result[key]
    return result


def save_json(path, value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+'.tmp')
    try:
        with temporary.open('w',encoding='utf-8') as stream:
            json.dump(common.make_json_serializable(value),stream,ensure_ascii=False,indent=2,allow_nan=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('json_path',type=Path)
    p.add_argument('--two-step-solution',required=True,type=Path)
    p.add_argument('--output',type=Path)
    p.add_argument('--threads',type=int,default=common.COPT_THREADS)
    p.add_argument('--mem-limit-gb',type=float,default=common.COPT_MEMLIMIT_MB/1024)
    p.add_argument('--time-limit',type=float,default=common.TIME_LIMIT_JOINT)
    p.add_argument('--no-time-limit',action='store_true')
    p.add_argument('--exact',action='store_true')
    p.add_argument('--no-accelerate',action='store_true')
    p.add_argument('--no-fractional-cuts',action='store_true')
    p.add_argument('--fractional-initial-rounds',type=int,default=20)
    p.add_argument('--fractional-interval',type=int,default=20)
    p.add_argument('--fractional-max-flows',type=int,default=32)
    p.add_argument('--fractional-max-cuts',type=int,default=16)
    p.add_argument('--fractional-budget-seconds',type=float,default=.25)
    p.add_argument('--quiet',action='store_true')
    p.add_argument('--overwrite',action='store_true')
    args=p.parse_args(argv)
    try:
        cfg=FractionalConfig(enabled=not args.no_fractional_cuts,
            initial_rounds=args.fractional_initial_rounds,interval=args.fractional_interval,
            max_flows=args.fractional_max_flows,max_cuts=args.fractional_max_cuts,
            budget_seconds=args.fractional_budget_seconds)
    except ValueError as exc:
        p.error(str(exc))
    output=(args.output or Path('result')/f'joint_{args.json_path.stem}.json').resolve()
    check_output=output.with_suffix('.check.json')
    protected={args.json_path.resolve(),args.two_step_solution.resolve()}
    if {output,check_output}.intersection(protected):
        p.error('Outputs must not overwrite data or the two-step result')
    if not args.overwrite and any(path.exists() for path in [output,check_output]):
        p.error('Output exists; choose a new path or use --overwrite')
    output.parent.mkdir(parents=True,exist_ok=True)
    lock=output.with_suffix('.lock')
    try:
        stream=lock.open('x')
    except FileExistsError:
        p.error(f'Another or interrupted run owns {lock}')
    with stream:
        try:
            stream.write(str(args.json_path.resolve()));stream.flush()
            started=time.perf_counter()
            data,data_sha=read_json(args.json_path)
            candidate,seed_sha=read_json(args.two_step_solution)
            audit_raw_data(data)
            pre=common.preprocess(data)
            denominator=common.nn_tour_energy(pre)
            # Validate the seed directly against RAW data before releasing it.
            seed_for_check=dict(candidate,method='joint',obj_bound=None,mip_gap=None,
                status='FEASIBLE_TWO_STEP_START',solver='feasibility_check_only')
            seed_for_check.pop('is_optimal',None)
            initial_check=validate_result(data,seed_for_check)
            if not initial_check['passed']:
                raise ValueError(f'Supplied two-step plan failed raw-data validation: {initial_check["errors"]}')
            print(f'[WARM START] {args.two_step_solution}; recorded two-step runtime='
                  f'{candidate.get("runtime")}s; internal two-step generation disabled',flush=True)
            print('[TIME NOTE] Core "Total runtime" reports the current joint phase wall time. '
                  'Final [SAVED] and JSON runtime use saved two-step time + COPT SolvingTime.',flush=True)
            del data;gc.collect()
            result=solve_joint(pre,candidate,energy_norm_denom=denominator,input_sha256=data_sha,
                time_limit=1e20 if args.no_time_limit else args.time_limit,
                threads=args.threads,memory_gb=args.mem_limit_gb,
                relative_gap=0.0 if args.exact else None,absolute_gap=0.0 if args.exact else None,
                fractional_config=cfg,accelerate=not args.no_accelerate,log_output=not args.quiet)
            del pre;gc.collect()
            data_after,sha_after=read_json(args.json_path)
            candidate_after,seed_sha_after=read_json(args.two_step_solution)
            if data_sha!=sha_after or seed_sha!=seed_sha_after:
                raise ValueError('Data or two-step solution changed during optimisation; refusing output')
            check=validate_result(data_after,result)
            if not check['passed']:
                raise ValueError(f'Final solution failed independent validation: {check["errors"]}')
            result.update(two_step_solution_file=str(args.two_step_solution.resolve()),
                two_step_solution_sha256=seed_sha,
                runtime_current_process_wall=time.perf_counter()-started,
                constraint_check_passed=True)
            result['runtime_wall_with_prior_two_step']=result['runtime_two_step']+result['runtime_current_process_wall']
            if args.overwrite:
                check_output.unlink(missing_ok=True)
            save_json(check_output,dict(check,data_sha256=data_sha,seed_sha256=seed_sha,
                seed_constraint_check_passed=initial_check['passed']))
            save_json(output,result)
            print(f'[SAVED] {output}; obj={result["obj"]:.12g}; warm_start=submitted; '
                  f'runtime={result["runtime_two_step"]:.9f} + {result["joint_solver_runtime"]:.9f}'
                  f' = {result["runtime"]:.9f}s',flush=True)
            return 0
        finally:
            lock.unlink(missing_ok=True)


if __name__=='__main__':raise SystemExit(main())
