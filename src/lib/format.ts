export function rupees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const [whole, fraction] = String(rounded).split('.');
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;
  return `₹${grouped}${fraction ? `.${fraction}` : ''}`;
}

export function qty(value: number, unit: string): string {
  const clean = Math.round(value * 1000) / 1000;
  return `${clean} ${unit}`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function todayLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function txnLabel(type: string): string {
  switch (type) {
    case 'sale':
      return 'Sale';
    case 'credit':
      return 'Udhaar';
    case 'payment':
      return 'Vasooli';
    case 'stock_in':
      return 'Maal aaya';
    case 'price':
      return 'Rate badla';
    default:
      return 'Entry';
  }
}
