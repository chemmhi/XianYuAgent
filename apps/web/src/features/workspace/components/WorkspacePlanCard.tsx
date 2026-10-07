import type { WorkspacePlanStatus, WorkspacePlanStepStatus, WorkspacePlanVM } from '../types';

export function WorkspacePlanCard({ plan }: { plan: WorkspacePlanVM }) {
  const completedCount = plan.steps.filter((step) => step.status === 'succeeded').length;
  const progress = Math.round((completedCount / plan.steps.length) * 100);
  return <aside className={`workspace-plan-float workspace-plan-float-${plan.status}`} data-testid="workspace-plan-card" data-plan-status={plan.status} aria-label="执行计划">
    <header className="workspace-plan-float-head">
      <div>
        <p className="workspace-plan-float-kicker">Plan Mode</p>
        <h3>执行计划</h3>
      </div>
      <span className="workspace-plan-float-status">{workspacePlanStatusLabel(plan.status)}</span>
    </header>
    <p className="workspace-plan-float-goal">{plan.goal}</p>
    <div className="workspace-plan-float-progress-row"><span>任务进度</span><strong>{completedCount} / {plan.steps.length}</strong></div>
    <div className="workspace-plan-float-progress" role="progressbar" aria-label="任务进度" aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={completedCount}><span style={{ width: `${progress}%` }} /></div>
    <ol className="workspace-plan-float-list" aria-label="核心任务列表">
      {plan.steps.map((step, index) => {
        const current = step.id === plan.currentStepId;
        return <li key={step.id} className={`workspace-plan-float-step workspace-plan-float-step-${step.status}${current ? ' is-current' : ''}`} data-testid="workspace-plan-step" data-step-id={step.id} data-step-status={step.status} aria-current={current ? 'step' : undefined}>
          <input type="checkbox" checked={step.status === 'succeeded'} readOnly disabled aria-label={`${index + 1}. ${step.goal}：${workspacePlanStepStatusLabel(step.status)}`} />
          <div className="workspace-plan-float-step-copy">
            <div className="workspace-plan-float-step-title"><strong>{step.goal}</strong>{current && <span className="workspace-plan-float-current">当前</span>}</div>
            <span className="workspace-plan-float-step-status">{workspacePlanStepStatusLabel(step.status)}</span>
          </div>
        </li>;
      })}
    </ol>
    <footer className="workspace-plan-float-foot"><span>修订 {plan.revision} · 仅展示核心任务</span><span>详细过程见对话</span></footer>
  </aside>;
}

function workspacePlanStatusLabel(status: WorkspacePlanStatus): string {
  return ({ active: '执行中', waiting_confirmation: '等待确认', blocked: '已阻塞', completed: '已完成' } as const)[status];
}

function workspacePlanStepStatusLabel(status: WorkspacePlanStepStatus): string {
  return ({ pending: '待执行', running: '执行中', succeeded: '已完成', waiting_confirmation: '等待确认', blocked: '已阻塞' } as const)[status];
}
