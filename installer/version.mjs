const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
const digits = /^\d+$/;

export function compareVersions(left, right) {
  const a = pattern.exec(left);
  const b = pattern.exec(right);
  if (!a || !b) throw new Error('The installed or bundled TIM version could not be read.');
  for (let index = 1; index <= 3; index++) {
    if (BigInt(a[index]) !== BigInt(b[index])) return BigInt(a[index]) < BigInt(b[index]) ? -1 : 1;
  }
  if (!a[4] || !b[4]) return Number(!a[4]) - Number(!b[4]);
  const before = a[4].split('.');
  const after = b[4].split('.');
  for (let index = 0; index < Math.min(before.length, after.length); index++) {
    const x = before[index], y = after[index];
    if (x === y) continue;
    if (digits.test(x) && digits.test(y)) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) < BigInt(y) ? -1 : 1;
    } else if (digits.test(x) || digits.test(y)) return digits.test(x) ? -1 : 1;
    else return x < y ? -1 : 1;
  }
  return Math.sign(before.length - after.length);
}
