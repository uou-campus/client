import type { Route } from '@/routing/route';
import type { DirectionStep } from '@/routing/directions';
import { arrivalText } from '@/routing/directions';
import { SURFACE_LABEL } from '@/routing/cost';
import { formatDuration } from '@/utils/format';
import * as s from './style.css';

interface Props {
  route: Route;
  steps: DirectionStep[];
}

const Directions = ({ route, steps }: Props) => {
  return (
    <ol className={s.steps}>
      {steps.map((step, i) => (
        <li key={i} className={s.step}>
          <span className={s.stepRail} aria-hidden />
          <span className={s.stepBody}>
            <span className={s.stepText}>{step.text}</span>
            <span className={s.stepTags}>
              {step.shortcut && <span className={s.tagCut}>지름길</span>}
              {step.surface !== 'path' && step.surface !== 'road' && (
                <span className={s.tag}>{SURFACE_LABEL[step.surface]}</span>
              )}
              {step.covered && <span className={s.tag}>비 안 맞음</span>}
              <span className={s.stepMeters}>
                약 {formatDuration(step.seconds)}
              </span>
            </span>
          </span>
        </li>
      ))}
      <li className={s.stepLast}>
        <span className={s.stepRailEnd} aria-hidden />
        <span className={s.stepBody}>
          <span className={s.stepText}>{arrivalText(route.to)}</span>
          {route.to.access && (
            <span className={s.stepMeters}>{route.to.access}</span>
          )}
        </span>
      </li>
    </ol>
  );
};

export default Directions;
