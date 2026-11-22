import { MagneticTile, type MarkerProps } from '@/features/magnetic-tile/magnetic-tile.tsx'
import { markerClass } from '@/features/magnetic-tile/marker'

import { CountdownMarkerCompact } from './compact'
import { CountdownMarkerExpanded } from './expanded'
import styles from './marker.module.scss'
import { useCountdownMarker } from './use-marker'

type Props = Omit<MarkerProps, 'children'>

function Marker(props: Props) {
  const layout = useCountdownMarker(props.size, props.shape, props.direction)

  return (
    <MagneticTile.Marker
      {...props}
      className={markerClass(
        styles,
        props.size,
        props.shape,
        props.direction,
        layout.isCompact ? styles.compact : styles.expanded,
        layout.wide && styles.wide,
        styles[layout.status]
      )}>
      {layout.isCompact ? (
        <CountdownMarkerCompact
          wide={layout.wide}
          status={layout.status}
          stripText={layout.stripText}
          progressPct={layout.progressPct}
        />
      ) : (
        <CountdownMarkerExpanded
          showDecor={layout.showDecor}
          showEarn={layout.showEarn}
          showTrack={layout.showTrack}
          showFooter={layout.showFooter}
          showPayday={layout.showPayday}
          showSalaryDetail={layout.showSalaryDetail}
          showDate={layout.showDate}
          status={layout.status}
          progressPct={layout.progressPct}
          progressTitle={layout.progressTitle}
          footerStatus={layout.footerStatus}
          workRange={layout.workRange}
          metricLabel={layout.metricLabel}
          metricValue={layout.metricValue}
          metricIcon={layout.metricIcon}
          isMetricDim={layout.isMetricDim}
          todayEarned={layout.computed.todayEarned}
          monthlySalary={layout.config.monthlySalary}
          dailySalary={layout.computed.dailySalary}
          isPayday={layout.computed.isPayday}
          daysUntilPayday={layout.computed.daysUntilPayday}
          paydayDate={layout.computed.paydayDate}
          now={layout.now}
        />
      )}
    </MagneticTile.Marker>
  )
}

export default Marker
