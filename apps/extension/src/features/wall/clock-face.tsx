/** 表盘画在磁贴表面上，时分秒跟系统时间走。 */
function ClockFace(props: { now: Date }) {
  const seconds = props.now.getSeconds()
  const minutes = props.now.getMinutes() + seconds / 60
  const hours = (props.now.getHours() % 12) + minutes / 60

  return (
    <svg
      viewBox="0 0 100 100"
      className="size-[78%] text-foreground"
      aria-hidden>
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="3"
      />
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(function (angle) {
        const radians = ((angle - 90) * Math.PI) / 180
        const inner = angle % 90 === 0 ? 34 : 38
        return (
          <line
            key={angle}
            x1={50 + Math.cos(radians) * inner}
            y1={50 + Math.sin(radians) * inner}
            x2={50 + Math.cos(radians) * 44}
            y2={50 + Math.sin(radians) * 44}
            stroke="currentColor"
            strokeWidth={angle % 90 === 0 ? 2.4 : 1.4}
            strokeLinecap="round"
          />
        )
      })}
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="28"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        transform={`rotate(${hours * 30} 50 50)`}
      />
      <line
        x1="50"
        y1="50"
        x2="50"
        y2="18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform={`rotate(${minutes * 6} 50 50)`}
      />
      <line
        x1="50"
        y1="54"
        x2="50"
        y2="16"
        stroke="var(--destructive)"
        strokeWidth="1.2"
        strokeLinecap="round"
        transform={`rotate(${seconds * 6} 50 50)`}
      />
      <circle
        cx="50"
        cy="50"
        r="2.4"
        fill="currentColor"
      />
    </svg>
  )
}

export { ClockFace }
