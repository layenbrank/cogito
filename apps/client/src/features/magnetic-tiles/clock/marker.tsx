import { MagneticTile, type MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { markerClass } from '@/features/magnetic-tile/marker'
import { AsidePanel } from '@/features/magnetic-tiles/clock/aside-panel.tsx'
import { ClockFace } from '@/features/magnetic-tiles/clock/clock-face.tsx'
import styles from '@/features/magnetic-tiles/clock/marker.module.scss'
import { useClockMarker } from '@/features/magnetic-tiles/clock/use-clock-marker.ts'

type Props = Omit<MarkerProps, 'children'>

function Marker(props: Props) {
  const state = useClockMarker(props)

  return (
    <MagneticTile.Marker
      {...props}
      className={markerClass(
        styles,
        props.size,
        props.shape,
        props.direction,
        styles[state.clockStyle],
        state.wide && styles.wide,
        state.showAside && styles.hasAside
      )}>
      <div className={styles.body}>
        <ClockFace
          clockStyle={state.clockStyle}
          now={state.now}
          hours={state.hours}
          minutes={state.minutes}
          seconds={state.seconds}
          showSeconds={state.showSeconds}
          useFlipDots={state.useFlipDots}
        />
        {state.showAside ? (
          <AsidePanel
            period={state.period}
            dateLabel={state.dateLabel}
            weekday={state.weekday}
            weekOfYear={state.weekOfYear}
            showPeriod={state.showPeriod}
            showWeek={state.showWeek}
            showNextAlarm={state.showNextAlarm}
            showAlarmSummary={state.showAlarmSummary}
            nextReminders={state.nextReminders}
            todayEnabled={state.todayEnabled}
            enabledTotal={state.enabledTotal}
            isNeon={state.isNeon}
            wide={state.wide}
          />
        ) : null}
      </div>
    </MagneticTile.Marker>
  )
}

export default Marker
