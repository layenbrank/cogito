/** 按小时划分一日时段 */
function findDayPeriod(hour: number) {
  const h = ((hour % 24) + 24) % 24
  if (h === 23 || h === 0) return '午夜'
  if (h <= 4) return '凌晨'
  if (h <= 10) return '早上'
  if (h <= 13) return '中午'
  if (h <= 16) return '下午'
  if (h <= 18) return '傍晚'
  return '晚上'
}

export { findDayPeriod }
