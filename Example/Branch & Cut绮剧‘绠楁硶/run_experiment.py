#!/usr/bin/env python3
"""Run one saved-two-step warm-start experiment at a time, with live logs."""
from __future__ import annotations

import argparse
from pathlib import Path
import subprocess
import sys


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    inputs=parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--data',type=Path)
    inputs.add_argument('--data-dir',type=Path)
    seeds=parser.add_mutually_exclusive_group()
    seeds.add_argument('--two-step-solution',type=Path)
    seeds.add_argument('--two-step-dir',type=Path)
    parser.add_argument('--out-dir',type=Path,default=Path('result'))
    parser.add_argument('--threads',type=int,default=8)
    parser.add_argument('--mem-limit-gb',type=float,default=40)
    parser.add_argument('--time-limit',type=float,default=3600)
    for flag in ['no-time-limit','exact','no-accelerate','no-fractional-cuts','quiet','overwrite']:
        parser.add_argument('--'+flag,action='store_true')
    parser.add_argument('--fractional-initial-rounds',type=int,default=20)
    parser.add_argument('--fractional-interval',type=int,default=20)
    parser.add_argument('--fractional-max-flows',type=int,default=32)
    parser.add_argument('--fractional-max-cuts',type=int,default=16)
    parser.add_argument('--fractional-budget-seconds',type=float,default=.25)
    args=parser.parse_args(argv)
    if args.data_dir and args.two_step_solution:
        parser.error('--two-step-solution is for a single --data file')
    if args.data_dir and not args.data_dir.is_dir():
        parser.error('Data directory does not exist')
    files=[args.data] if args.data else sorted(args.data_dir.rglob('*.json'))
    if not files:
        parser.error('No input JSON files found')
    if len({p.stem for p in files})!=len(files):
        parser.error('Duplicate data stems would overwrite results; use distinct names')
    seed_dir=args.two_step_dir or Path('two_step_results')
    jobs=[(data,args.two_step_solution or seed_dir/f'two_step_{data.stem}.json',
           args.out_dir/f'joint_{data.stem}.json') for data in files]
    # Preflight the whole batch before running any solver. No fuzzy matching,
    # fallback seed generation, or accidental reuse of another data file.
    protected={p.resolve() for data,seed,_ in jobs for p in (data,seed)}
    for data,seed,output in jobs:
        if not data.is_file() or not seed.is_file():
            parser.error(f'Missing data or two-step result: {data}, {seed}')
        outputs=[output,output.with_suffix('.check.json'),output.with_suffix('.log')]
        if any(p.resolve() in protected for p in outputs):
            parser.error('An output path would overwrite an input')
        if not args.overwrite and any(p.exists() for p in outputs):
            parser.error(f'Output already exists for {data.name}; use a new directory or --overwrite')
    args.out_dir.mkdir(parents=True,exist_ok=True)
    entry=Path(__file__).resolve().with_name('joint_copt_from_two_step.py')
    failures=[]
    for index,(data,seed,output) in enumerate(jobs,1):
        cmd=[sys.executable,'-u',str(entry),str(data),'--two-step-solution',str(seed),
             '--output',str(output)]
        for name in ['threads','mem_limit_gb','time_limit','fractional_initial_rounds',
                     'fractional_interval','fractional_max_flows','fractional_max_cuts',
                     'fractional_budget_seconds']:
            cmd.extend(['--'+name.replace('_','-'),str(getattr(args,name))])
        for name in ['no_time_limit','exact','no_accelerate','no_fractional_cuts','quiet','overwrite']:
            if getattr(args,name):cmd.append('--'+name.replace('_','-'))
        print(f'[START {index}/{len(jobs)}] {data.name}; seed={seed}',flush=True)
        log_path=output.with_suffix('.log')
        # Exclusive creation prevents two tmux workers sharing a result name.
        with log_path.open('w' if args.overwrite else 'x',encoding='utf-8') as log:
            log.write('COMMAND: '+repr(cmd)+'\n');log.flush()
            with subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                                  text=True,encoding='utf-8',errors='replace') as process:
                for line in process.stdout:
                    print(line,end='',flush=True);log.write(line);log.flush()
                returncode=process.wait()
        if returncode:failures.append(data.name)
        print(f'[FINISH] {data.name}; returncode={returncode}; log={log_path}',flush=True)
    print(f'[BATCH] total={len(jobs)}; succeeded={len(jobs)-len(failures)}; failed={failures}',flush=True)
    return int(bool(failures))


if __name__=='__main__':raise SystemExit(main())
