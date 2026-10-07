import { useLayoutEffect, useRef, useState } from 'react';
import type { WorkspacePlanStatus, WorkspacePlanStepStatus, WorkspacePlanVM } from '../types';

export function getWorkspacePlanScrollDelta(cardTop: number, cardBottom: number, stepTop: number, stepBottom: number): number {
  if (stepTop < cardTop) return stepTop - cardTop;
  if (stepBottom > cardBottom) return stepBottom - cardBottom;
  return 0;
}

export function WorkspacePlanCard({ plan }: { plan: WorkspacePlanVM }) {
  const [expanded, setExpanded] = useState(true);
  const cardRef = useRef<HTMLElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);
  const completedCount = plan.steps.filter((step) => step.status === 'succeeded').length;
  const progress = Math.round((completedCount / plan.steps.length) * 100);
  const bodyId = `workspace-plan-body-${plan.revision}`;

  useLayoutEffect(() => {
    if (!expanded) return;
    const card = cardRef.current;
    const currentStep = currentStepRef.current;
    if (!card || !currentStep || card.scrollHeight <= card.clientHeight) return;
    const cardRect = card.getBoundingClientRect();
    const stepRect = currentStep.getBoundingClientRect();
    card.scrollTop += getWorkspacePlanScrollDelta(cardRect.top, cardRect.bottom, stepRect.top, stepRect.bottom);
  }, [expanded, plan.currentStepId, plan.revision, plan.steps.length]);

  return <aside ref={cardRef} className={`workspace-plan-float workspace-plan-float-${plan.status}${expanded ? '' : ' is-collapsed'}`} data-testid="workspace-plan-card" data-plan-status={plan.status} data-plan-expanded={expanded ? 'true' : 'false'} aria-label="执行计划">
    <header className="workspace-plan-float-head">
      <div>
        <p className="workspace-plan-float-kicker">Plan Mode</p>
        <h3>执行计划</h3>
      </div>
      <div className="workspace-plan-float-head-actions">
        <span className="workspace-plan-float-status">{workspacePlanStatusLabel(plan.status)}</span>
        <button className="workspace-plan-float-toggle" type="button" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((value) => !value)}>
          <span>{expanded ? '收起' : '展开'}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d={expanded ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'} /></svg>
        </button>
      </div>
    </header>
    <div id={bodyId} className="workspace-plan-float-body" hidden={!expanded}>
      <p className="workspace-plan-float-goal">{plan.goal}</p>
      <div className="workspace-plan-float-progress-row"><span>任务进度</span><strong>{completedCount} / {plan.steps.length}</strong></div>
      <div className="workspace-plan-float-progress" role="progressbar" aria-label="任务进度" aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={completedCount}><span style={{ width: `${progress}%` }} /></div>
      <ol className="workspace-plan-float-list" aria-label="核心任务列表">
        {plan.steps.map((step, index) => {
          const current = step.id === plan.currentStepId;
          return <li ref={current ? currentStepRef : undefined} key={step.id} className={`workspace-plan-float-step workspace-plan-float-step-${step.status}${current ? ' is-current' : ''}`} data-testid="workspace-plan-step" data-step-id={step.id} data-step-status={step.status} aria-current={current ? 'step' : undefined}>
            <input type="checkbox" checked={step.status === 'succeeded'} readOnly disabled aria-label={`${index + 1}. ${step.goal}：${workspacePlanStepStatusLabel(step.status)}`} />
            <div className="workspace-plan-float-step-copy">
              <div className="workspace-plan-float-step-title"><strong>{step.goal}</strong>{current && <span className="workspace-plan-float-current">当前</span>}</div>
              <span className="workspace-plan-float-step-status">{workspacePlanStepStatusLabel(step.status)}</span>
            </div>
          </li>;
        })}
      </ol>
      <footer className="workspace-plan-float-foot"><span>修订 {plan.revision} · 仅展示核心任务</span><span>详细过程见对话</span></footer>
    </div>
  </aside>;
}

function workspacePlanStatusLabel(status: WorkspacePlanStatus): string {
  return ({ active: '执行中', waiting_confirmation: '等待确认', blocked: '已阻塞', completed: '已完成' } as const)[status];
}

function workspacePlanStepStatusLabel(status: WorkspacePlanStepStatus): string {
  return ({ pending: '待执行', running: '执行中', succeeded: '已完成', waiting_confirmation: '等待确认', blocked: '已阻塞' } as const)[status];
}
