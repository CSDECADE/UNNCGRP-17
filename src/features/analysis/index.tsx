import { useEditor } from "../../core/editor";
import { importPlan, routeFor } from "../../core/project";
import { Icon } from "../../ui/Icon";
import type { AnalysisPanelProps, Editor } from "../contracts";

export function acceptPlan(text: string, e: Editor, playbackAvailable: boolean) {
      e.setCandidate(importPlan(text, e.project));
      e.select(null);
      e.setPreview(playbackAvailable);
      e.setProgress(0);
      e.setPlaying(false);
      e.setTool("select");
      e.setMessage("方案已载入预览。应用后将替换当前拍摄点。");
}

export function AnalysisPanel({ openFile, exportFile, filesAvailable }: AnalysisPanelProps) {
  const e = useEditor();
  return (<>
    <section aria-label="各无人机的拍摄点">
      <h3>各无人机的拍摄点</h3>
      <ul>{e.project.drones.map(drone => (
        <li key={drone.id}>{drone.name} · {routeFor(e.project, drone.id).length} 个拍摄点</li>
      ))}</ul>
    </section>
    {!filesAvailable && <p>加载导出和文档模块后可交换方案文件。</p>}
<div className="algorithm-content">
                  <div className="algorithm-step">
                    <span>01</span>
                    <div>
                      <h3>导出场景</h3>
                      <p>包含模型、无人机设置和拍摄点。</p>
                    </div>
                    <button
                      className="secondary-button" disabled={!filesAvailable}
                      onClick={() =>
                        exportFile(
                          {
                            ...e.project,
                            coordinateSystem: { unit: "meter", up: "Y" },
                          },
                          "Aero-scene.json",
                        )
                      }
                    >
                      <Icon name="download" />
                      导出
                    </button>
                  </div>
                  <div className="algorithm-step">
                    <span>02</span>
                    <div>
                      <h3>导入航拍方案</h3>
                      <p>先预览，应用后替换当前拍摄点。</p>
                    </div>
                    <button
                      className="secondary-button" disabled={!filesAvailable}
                      onClick={() => openFile("plan")}
                    >
                      <Icon name="upload" />
                      导入
                    </button>
                  </div>
                  <details className="format-note">
                    <summary>文件格式说明</summary>
                    <p>支持 JSON 文件，大小不超过 5 MB。坐标单位为米，Y 轴为高度。</p>
                    <p>
                      JSON 包含 version: 1 和 viewpoints 列表。每个拍摄点包含
                      id、name、droneId、position、target。droneId
                      对应当前场景中的无人机标识。
                    </p>
                    <p>
                      time 为从方案开始计的秒数，可省略；同一航线应全部提供且严格递增。所有拍摄点都包含时间时按方案时间播放，否则按顺序示意播放。
                    </p>
                    <button
                      className="text-button" disabled={!filesAvailable}
                      onClick={() =>
                        exportFile(
                          { version: 1, viewpoints: e.project.viewpoints },
                          "Aero-plan.json",
                        )
                      }
                    >
                      导出当前方案{" "}
                      <Icon name="download" size={13} />
                    </button>
                  </details>
                  <p className="note">
                    导入不会自动规划航线或检查碰撞。预演仅用于模拟，不控制真实无人机。
                  </p>
                </div>
  </>);
}

export function CandidateBanner({ clearError }: { clearError: () => void }) {
  const e = useEditor();
  return (<> 
          {e.candidate && (
            <div className="candidate-banner">
              <Icon name="flask" />
              <span>预览导入方案</span>
              <button
                onClick={() => {
                  const p = e.candidate!;
                  e.setCandidate(null);
                  e.commit(p, false);
                  clearError();
                  e.setMessage("方案已应用。可撤销以恢复原方案。");
                }}
              >
                应用方案
              </button>
              <button
                onClick={() => {
                  e.setCandidate(null);
                  clearError();
                  e.setPlaying(false);
                  e.setProgress(0);
                  e.select(null);
                }}
              >
                取消
              </button>
            </div>
          )}
  </>);
}
