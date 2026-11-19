"""Native COPT regression tests; test instances fit a size-limited licence."""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import itertools
import json
import math
import os
from pathlib import Path
import random
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import common
import joint_copt_from_two_step as entry
import joint_copt_undirected as core
from check_joint_results import validate_result
from joint_mip_start import validate_initial_solution


def fixture(seed=0,n=5):
    rng=random.Random(seed)
    coords=[(0,0,0)]+[(rng.uniform(1,10),rng.uniform(1,10),rng.uniform(0,5)) for _ in range(n-2)]+[(100,100,20)]
    pairs=[[f'v{k}','a0'] for k in range(n)]
    return dict(view_points=[dict(id=f'v{k}',coordinate=dict(zip(['x','y','z'],point)),is_depot=k==0)
                             for k,point in enumerate(coords)],
                sample_points=[dict(covering_pairs=pairs+[pairs[0]])],
                hemisphere_points=[dict(covering_pairs=pairs,weight=1)],
                collision_matrix=[[int(i!=j) for j in range(n)] for i in range(n)])


def data_fixture(seed=0,n=5):
    # Separate construction keeps some equal Boolean hemisphere functions and
    # overlapping coverage, rather than testing only a routing-only objective.
    data=fixture(seed,n)
    pairs=data['sample_points'][0]['covering_pairs'][:-1]
    data['hemisphere_points']=([dict(covering_pairs=pairs,weight=1),
        dict(covering_pairs=list(reversed(pairs)),weight=.25)]+
        [dict(covering_pairs=[pair],weight=.2) for pair in pairs])
    return data


def preprocess(data):
    with contextlib.redirect_stdout(io.StringIO()):return common.preprocess(data)


def full_seed(pre,runtime=12.5):
    n=pre['n_vp'];tour=list(range(n))+[0];photos=[list(p) for p in pre['valid_pairs']]
    denominator=common.nn_tour_energy(pre)
    witness=validate_initial_solution(pre,dict(selected_vps=list(range(n)),selected_pairs=photos,tour=tour),denominator,3)
    energy=math.fsum(pre['energy'][e] for e in zip(tour,tour[1:]))
    quality=math.fsum(pre['gamma'][h] for h,covered in enumerate(witness.hemisphere_covered) if covered)
    readable=[[pre['vp_ids'][k],a] for k,a in photos]
    return dict(method='two_step',selected_vps=list(range(n)),selected_pairs=photos,tour=tour,
        selected_vp_ids=pre['vp_ids'],tour_ids=[pre['vp_ids'][k] for k in tour],
        selected_photos_readable=readable,photos_by_viewpoint={vid:['a0'] for vid in pre['vp_ids']},
        energy=energy,weighted_quality=float(quality),photos=len(photos),n_viewpoints=n,
        energy_norm_denom=denominator,energy_norm=energy/denominator,
        quality_norm=float(quality/pre['total_omega']),photo_norm=len(photos)/pre['n_pairs'],
        obj=witness.objective,runtime=runtime,atsp_runtime=0.,runtime_step1=2.,runtime_step2=3.,
        status=1,obj_bound=None,mip_gap=None,stage1_source='synthetic_test')


def brute_force(pre):
    denominator=common.nn_tour_energy(pre);best=math.inf
    for size in range(3,pre['n_vp']+1):
        for others in itertools.combinations(range(1,pre['n_vp']),size-1):
            chosen={0,*others};photos={(k,'a0') for k in chosen}
            quality=sum(float(pre['gamma'][h]) for h,cov in enumerate(pre['hp_cover']) if photos.intersection(cov))
            for order in itertools.permutations(others):
                tour=(0,*order,0)
                energy=sum(pre['energy'][e] for e in zip(tour,tour[1:]))
                best=min(best,energy/denominator-quality/pre['total_omega']+size/pre['n_pairs'])
    return best


class ExternalStartTests(unittest.TestCase):
    def test_core_files_are_byte_identical_to_baseline(self):
        manifest=json.loads((ROOT/'CORE_BASELINE_SHA256.json').read_text())
        for name,digest in manifest.items():
            with self.subTest(file=name):
                self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),digest)

    def test_native_warm_and_cold_match_independent_optima(self):
        rows=[]
        with mock.patch.object(core,'COPT_THREADS',1),mock.patch.object(core,'run_two_step',side_effect=AssertionError('Must not generate a seed')):
            for index in range(12):
                with self.subTest(instance=index),contextlib.redirect_stdout(io.StringIO()):
                    data=data_fixture(index,4+index%3);pre=preprocess(data);seed=full_seed(pre)
                    old=core.solve_joint(pre,use_two_step_start=False,log_output=False,
                        time_limit=30,relative_gap=0.,absolute_gap=0.)
                    new=entry.solve_joint(pre,seed,threads=1,log_output=False,
                        time_limit=30,relative_gap=0.,absolute_gap=0.)
                    optimum=brute_force(pre)
                    for result in [old,new]:
                        self.assertEqual(result['status'],1)
                        self.assertAlmostEqual(result['obj'],optimum,places=8)
                        self.assertLessEqual(result['mip_gap'],1e-12)
                        self.assertAlmostEqual(result['obj_bound'],result['obj'],places=8)
                        self.assertEqual(result['relative_gap_limit'],0.)
                        self.assertEqual(result['absolute_gap_limit'],0.)
                        report=validate_result(data,result)
                        self.assertTrue(report['passed'],report['errors'])
                    self.assertLess(new['obj'],seed['obj']-1e-3) # Start does NOT fix its decisions.
                    self.assertEqual(new['warm_start_status'],'submitted')
                    self.assertEqual(new['runtime'],12.5+new['joint_solver_runtime'])
                    self.assertEqual(new['runtime_joint'],new['joint_solver_runtime'])
                    self.assertEqual(new['runtime_step1'],2.)
                    self.assertEqual(new['runtime_step2'],3.)
                    self.assertEqual(new['fractional_config'],old['fractional_config'])
                    rows.append(dict(instance=index,cold=old['obj'],warm=new['obj'],oracle=optimum,
                        cold_gap=old['mip_gap'],warm_gap=new['mip_gap'],
                        cold_status=old['status'],warm_status=new['status']))
        self.assertEqual(len(rows),12)
        if os.environ.get('EXTERNAL_START_TEST_REPORT'):
            Path(os.environ['EXTERNAL_START_TEST_REPORT']).write_text(json.dumps(rows,indent=2)+'\n')

    def test_invalid_seed_is_rejected_before_solver(self):
        pre=preprocess(data_fixture());seed=full_seed(pre)
        cases=[]
        for value in [None,-1,float('nan'),float('inf'),True,'12']:
            bad=copy.deepcopy(seed);bad['runtime']=value;cases.append(bad)
        for key,value in [('method','joint'),('obj',seed['obj']+1),
                          ('energy_norm_denom',seed['energy_norm_denom']+1),
                          ('input_sha256','wrong'),('stage1_source','provided'),
                          ('tour',[0,1,2,0]),('selected_pairs',[])]:
            bad=copy.deepcopy(seed);bad[key]=value;cases.append(bad)
        with mock.patch.object(core,'solve_joint') as solver:
            for bad in cases:
                with self.subTest(bad=repr(bad)),self.assertRaises((ValueError,KeyError,TypeError)):
                    entry.solve_joint(pre,bad,log_output=False)
            solver.assert_not_called()

    def test_zero_recorded_runtime_is_accepted(self):
        pre=preprocess(data_fixture());seed=full_seed(pre,0.)
        witness,runtime=entry.prepare_start(pre,seed,common.nn_tour_energy(pre))
        self.assertEqual(runtime,0.)
        self.assertEqual(witness.visited,frozenset(range(5)))

    def test_resource_settings_restored_on_error_and_no_cold_fallback(self):
        pre=preprocess(data_fixture());seed=full_seed(pre)
        before=(core.COPT_THREADS,core.COPT_MEMLIMIT_MB)
        with mock.patch.object(core,'solve_joint',side_effect=RuntimeError('test')):
            with self.assertRaisesRegex(RuntimeError,'test'):
                entry.solve_joint(pre,seed,threads=3,memory_gb=7.)
        self.assertEqual((core.COPT_THREADS,core.COPT_MEMLIMIT_MB),before)
        with mock.patch.object(core,'solve_joint',return_value={'warm_start_status':'failed'}):
            with self.assertRaisesRegex(RuntimeError,'not submitted'):entry.solve_joint(pre,seed)

    def test_batch_cli_and_mandatory_seed_matching(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);data_dir=root/'data';seed_dir=root/'seeds';out=root/'out'
            data_dir.mkdir();seed_dir.mkdir()
            data=data_fixture();seed=full_seed(preprocess(data))
            (data_dir/'tiny.json').write_text(json.dumps(data))
            (seed_dir/'two_step_tiny.json').write_text(json.dumps(seed))
            command=[sys.executable,str(ROOT/'run_experiment.py'),'--data-dir',str(data_dir),
                '--two-step-dir',str(seed_dir),'--out-dir',str(out),'--threads','1','--exact','--quiet']
            run=subprocess.run(command,text=True,capture_output=True)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            result=json.loads((out/'joint_tiny.json').read_text())
            report=json.loads((out/'joint_tiny.check.json').read_text())
            self.assertTrue(report['passed']);self.assertTrue(report['seed_constraint_check_passed'])
            self.assertEqual(result['runtime'],seed['runtime']+result['joint_solver_runtime'])
            self.assertEqual(result['two_step_solution_sha256'],hashlib.sha256((seed_dir/'two_step_tiny.json').read_bytes()).hexdigest())
            self.assertTrue((out/'joint_tiny.log').is_file())
            self.assertFalse(list(out.glob('*.lock')))
            repeat=subprocess.run(command,text=True,capture_output=True)
            self.assertNotEqual(repeat.returncode,0)
            (seed_dir/'two_step_tiny.json').unlink()
            missing=subprocess.run(command+['--overwrite'],text=True,capture_output=True)
            self.assertNotEqual(missing.returncode,0)
            self.assertIn('Missing data or two-step result',missing.stderr)


if __name__=='__main__':unittest.main()
