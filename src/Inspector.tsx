import { useEditor } from "./core/editor";
import { Icon } from "./ui/Icon";
import { shortcuts } from "./platform";
import { BackgroundSettings } from "./BackgroundSettings";
export function Inspector() {
  const e = useEditor();
    return (
      <div className="inspector-scroll">
        <section className="property-section">
          <h3>场景</h3>
          <div className="property-line">
            <span>单位</span>
            <span>米 · m</span>
          </div>
        </section>
        <BackgroundSettings />
        <section className="property-section">
          <h3>项目内容</h3>
          <div className="property-line">
            <span>模型</span>
            <span>{e.project.models.length}</span>
          </div>
          <div className="property-line">
            <span>无人机</span>
            <span>{e.project.drones.length}</span>
          </div>
          <div className="property-line">
            <span>拍摄点</span>
            <span>{e.project.viewpoints.length}</span>
          </div>
        </section>
        <section className="property-section inspector-intro">
          <Icon name="cursor" size={24} />
          <p>选择一个对象</p>
          <small>
            在场景或左侧列表中选择模型、无人机或拍摄点，查看和编辑属性。
          </small>
        </section>
        <section className="property-section help-keys">
          <h3>操作提示</h3>
          <p>
            {e.view === "perspective" ? "旋转视角" : "平移视图"} <kbd>空白处拖动</kbd>
          </p>
          <p>
            平移场景 <kbd>右键拖动</kbd>
          </p>
          <p>
            缩放场景 <kbd>滚轮</kbd>
          </p>
          <p>
            聚焦对象 <kbd>F</kbd>
          </p>
          <p>
            撤销 <kbd>{shortcuts.undo}</kbd>
          </p>
          <p>
            保存项目 <kbd>{shortcuts.save}</kbd>
          </p>
        </section>
      </div>
    );
}
