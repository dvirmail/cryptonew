
/* Adaptive currency and price formatters with support for tiny-priced coins (e.g., SHIB, BONK) */

export function formatUSDT(value, { minDecimals, maxDecimals } = {}) {
  const num = Number(value);
  if (!isFinite(num)) return '$0.00';

  // Adaptive decimals based on magnitude if not provided
  let decimals;
  if (typeof minDecimals === 'number' || typeof maxDecimals === 'number') {
    // Respect explicit override
    decimals = Math.max(0, Math.min(8, maxDecimals ?? minDecimals ?? 2));
  } else {
    if (Math.abs(num) >= 1000) decimals = 0;
    else if (Math.abs(num) >= 100) decimals = 1;
    else if (Math.abs(num) >= 1) decimals = 2;
    else if (Math.abs(num) >= 0.1) decimals = 3;
    else if (Math.abs(num) >= 0.01) decimals = 4;
    else if (Math.abs(num) >= 0.001) decimals = 5;
    else decimals = 6;
  }

  const formatted = num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `$${formatted}`;
}

export function formatPrice(value, { minDecimals, maxDecimals } = {}) {
  const num = Number(value);
  if (!isFinite(num)) return '0.00';

  // Adaptive decimals for asset prices; tiny coins need more precision
  let minD = minDecimals;
  let maxD = maxDecimals;

  if (minD == null || maxD == null) {
    // Set sensible defaults if not provided
    if (num >= 1000) {
      minD = 0; maxD = 0;
    } else if (num >= 100) {
      minD = 1; maxD = 2;
    } else if (num >= 1) {
      minD = 2; maxD = 4;
    } else if (num >= 0.1) {
      minD = 3; maxD = 5;
    } else if (num >= 0.01) {
      minD = 4; maxD = 6;
    } else if (num >= 0.001) {
      minD = 5; maxD = 7;
    } else {
      minD = 6; maxD = 8;
    }
  }

  return num.toLocaleString(undefined, {
    minimumFractionDigits: Math.max(0, Math.min(8, minD)),
    maximumFractionDigits: Math.max(0, Math.min(8, maxD)),
  });
}

// Adaptive formatter for tiny-priced coins (avoids rendering 0.00 for SHIB/BONK)
export function formatCryptoPriceSmart(price) {
  const n = Number(price);
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '$0.00';
  const abs = Math.abs(n);
  let decimals = 2;
  if (abs < 1) decimals = 4;
  if (abs < 0.1) decimals = 5;
  if (abs < 0.01) decimals = 6;
  if (abs < 0.001) decimals = 7;
  if (abs < 0.0001) decimals = 8;
  if (abs < 0.00001) decimals = 9;
  if (abs < 0.000001) decimals = 10;
  if (abs < 0.0000001) decimals = 12;
  return `$${n.toFixed(decimals)}`;
}

// Adaptive formatter for tiny crypto quantities
export function formatCryptoQtySmart(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return '-';
  if (n === 0) return '0';
  const abs = Math.abs(n);
  let decimals = 4;
  if (abs < 1) decimals = 6;
  if (abs < 0.1) decimals = 8;
  if (abs < 0.01) decimals = 10;
  if (abs < 0.001) decimals = 12;
  return n.toFixed(decimals);
}
