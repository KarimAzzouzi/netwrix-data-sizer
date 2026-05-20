export function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function fmtSize(gb) {
  const n = parseFloat(gb)
  return n >= 1024 ? (n / 1024).toFixed(2) + ' TB' : n.toFixed(2) + ' GB'
}

export function tierClass(tier) {
  if (!tier) return 'bg-green-100 text-green-700'
  if (tier.includes('Extra')) return 'bg-red-950 text-red-200'
  if (tier.includes('Large')) return 'bg-red-100 text-red-700'
  if (tier.includes('Mid')) return 'bg-orange-100 text-orange-700'
  return 'bg-green-100 text-green-700'
}
