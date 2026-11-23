# Flight Path Playback

## Overview

The playback module provides interactive visualization of drone flight paths in Aero. It supports playback and pause, timeline seeking, reset, playback speed adjustment, and inspection through the drone camera view. Playback stops automatically at the end of the timeline; starting playback again restarts the sequence from the beginning.

The built-in example can demonstrate the module independently. File management, manual editing, and path analysis remain separate optional modules.

## Usage

1. Open the built-in example project.
2. Select **Preview** using the bottom toolbar.
3. Select **Play Flight Path** on the playback bar.
4. Use the timeline to seek, select a playback speed, or switch to the drone camera view to inspect the sequence.

The available playback speeds are **0.5×, 1×, 1.5×, 2×, and 3×**. Seeking pauses playback at the selected position. **Reset to Start** returns the timeline to zero and leaves playback paused. **Exit Preview** stops playback, resets progress, and restores the perspective view if the drone camera view is active.

Control names in this document are English descriptions of the corresponding controls in the current Chinese-language interface.

## Timing Model

Timing follows the rules provided by the base application:

| Mode | Condition | Behavior |
| --- | --- | --- |
| Plan time | Every viewpoint has a timestamp. | Playback uses the supplied timestamps and the total duration returned by `timing()`. |
| Simulated time | One or more viewpoints have no timestamp. | Adjacent viewpoints on each drone's route are spaced six seconds apart. The shared timeline uses the duration returned by `timing()`. |

Simulated time is intended for visualization and does not represent an estimate of actual flight duration.

## Integration

The entry point is the `Playback` component exported from `src/features/playback/index.tsx`. The base application's `src/features/modules.tsx` discovers this component automatically. Integration requires no changes to the shared application entry point and introduces no additional dependencies.

The component uses `useEditor()` to access preview state, playback state, normalized progress, and playback speed. It obtains the shared timeline duration from `timing()`. The existing scene renderer uses `poseAt()` to interpolate each drone's position and camera target. Updating playback progress does not modify the project's stored viewpoint data.

## Verification

Install dependencies and run the static checks and production build:

```sh
npm ci
npm run check
npm run build
```

Launch the browser preview with `npm run dev:web`, or launch the Electron application with `npm run dev`. Perform the following acceptance checks:

| Scenario | Procedure | Expected result |
| --- | --- | --- |
| Preview initialization | Open the built-in example and enter preview mode. | The playback bar appears with the timeline at zero. |
| Playback and pause | Start playback, then pause. | Time advances and drones follow their respective routes; pausing holds the current time and positions. |
| Timeline seeking | Drag the progress slider during playback. | Playback pauses, and the displayed time and drone positions update to the selected point. |
| Reset | Select Reset to Start. | Progress returns to zero and playback remains paused. |
| Playback speed | Select each supported speed while playing. | The rate of progress changes without resetting the current timeline position. |
| Drone camera | Switch to the drone camera view during preview. | The camera follows the selected drone's interpolated position and target. |
| Keyboard control | Press Space while preview is active and focus is outside inputs, dialogs, and menus. | Playback toggles between playing and paused. |
| Completion and replay | Allow playback to finish, then start playback again. | Playback pauses at the end and restarts from zero on the next play action. |
| Exit preview | Select Exit Preview on the playback bar. | Playback stops and progress resets to zero. An active drone camera view returns to the perspective view. |
| Empty project | Create an empty project and enter preview mode. | A prompt requests viewpoints; the play button and progress slider are disabled. |

For timestamped plans, use the file management or analysis module to load a plan in which every viewpoint has a timestamp. Confirm that the playback bar indicates plan time and that the duration and interpolation follow the base application's timing rules. The built-in example is sufficient to verify simulated-time playback when only this module is installed.

## Known Limitations

Playback advances using `requestAnimationFrame` and elapsed wall-clock time. Browsers or operating systems may suspend animation callbacks while a tab or window is in the background. On resuming, progress may jump forward or reach the end of the timeline.

Path planning, collision detection, and physical flight simulation are outside this module's scope. Viewpoint editing, file import, and plan analysis are provided by their respective modules.
