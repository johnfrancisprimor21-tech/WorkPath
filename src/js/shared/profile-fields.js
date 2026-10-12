import { el, field } from './dom.js';

const PAY_FREQUENCIES = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every two weeks'],
  ['semi_monthly', 'Twice a month'],
  ['monthly', 'Monthly']
];

const COMMON_CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD'];

export function createPreferenceFields(profile = {}, scope = 'preferences') {
  if (typeof Intl.supportedValuesOf !== 'function') {
    throw new Error('This browser does not support currency and time zone choices. Please update your browser and try again.');
  }

  const currencies = [...new Set([...Intl.supportedValuesOf('currency'), ...COMMON_CURRENCIES])].sort();
  const currencySet = new Set(currencies);
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const timeZones = new Set(Intl.supportedValuesOf('timeZone'));
  timeZones.add('UTC');
  if (detectedTimeZone) timeZones.add(detectedTimeZone);
  if (profile.timezone) timeZones.add(profile.timezone);

  const selectedTimeZone = profile.timezone || detectedTimeZone;
  const timeZoneSet = new Set(timeZones);
  const payFrequencySet = new Set(PAY_FREQUENCIES.map(([value]) => value));
  const container = el('div', { className: 'preference-fields' });

  const currencySelect = el('select', { attrs: { name: 'currency', required: '' } });
  currencySelect.required = true;
  currencySelect.append(el('option', { text: 'Choose a currency', attrs: { value: '' } }));

  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    displayNames = null;
  }

  const commonCodes = new Set(COMMON_CURRENCIES);
  const commonGroup = el('optgroup', { attrs: { label: 'Common' } });
  for (const code of COMMON_CURRENCIES) {
    if (currencySet.has(code)) commonGroup.append(currencyOption(code, displayNames));
  }
  currencySelect.append(commonGroup);

  const allCurrenciesGroup = el('optgroup', { attrs: { label: 'All currencies' } });
  for (const code of currencies) {
    if (!commonCodes.has(code)) allCurrenciesGroup.append(currencyOption(code, displayNames));
  }
  currencySelect.append(allCurrenciesGroup);
  currencySelect.value = profile.currency || '';
  container.append(field('Currency', currencySelect, { hint: 'Choose a three-letter currency code.' }));

  const payFrequency = el('select', { attrs: { name: 'pay_frequency', required: '' } });
  payFrequency.append(el('option', { text: 'Choose a pay frequency', attrs: { value: '' } }));
  for (const [value, label] of PAY_FREQUENCIES) {
    payFrequency.append(el('option', { text: label, attrs: { value } }));
  }
  payFrequency.value = profile.pay_frequency || '';
  container.append(field('Pay frequency', payFrequency));

  const timeZoneSelect = el('select', { attrs: { name: 'timezone', required: '' } });
  timeZoneSelect.required = true;
  timeZoneSelect.append(el('option', { text: 'Choose a time zone', attrs: { value: '' } }));

  const referenceDate = new Date();
  if (detectedTimeZone) {
    const detectedGroup = el('optgroup', { attrs: { label: 'Detected on this device' } });
    detectedGroup.append(timeZoneOption(detectedTimeZone, referenceDate));
    timeZoneSelect.append(detectedGroup);
  }

  const zonesByRegion = new Map();
  for (const zone of timeZones) {
    if (zone === detectedTimeZone) continue;
    const region = zone.split('/')[0];
    if (!zonesByRegion.has(region)) zonesByRegion.set(region, []);
    zonesByRegion.get(region).push(zone);
  }

  for (const region of [...zonesByRegion.keys()].sort((a, b) => a.localeCompare(b))) {
    const regionGroup = el('optgroup', { attrs: { label: region } });
    const zones = zonesByRegion.get(region);
    zones.sort((left, right) => {
      const offsetDifference = getUtcOffsetMinutes(left, referenceDate) - getUtcOffsetMinutes(right, referenceDate);
      return offsetDifference || left.localeCompare(right);
    });
    for (const zone of zones) regionGroup.append(timeZoneOption(zone, referenceDate));
    timeZoneSelect.append(regionGroup);
  }

  timeZoneSelect.value = selectedTimeZone;
  container.append(field('Time zone', timeZoneSelect, { hint: 'Detected from this device. Check that it is right.' }));

  return {
    element: container,
    read() {
      return {
        currency: currencySelect.value,
        pay_frequency: payFrequency.value,
        timezone: timeZoneSelect.value
      };
    },
    validate() {
      const values = this.read();
      if (!currencySet.has(values.currency)) return 'Choose a currency from the list.';
      if (!payFrequencySet.has(values.pay_frequency)) return 'Choose a pay frequency.';
      if (!timeZoneSet.has(values.timezone)) return 'Choose a time zone from the list.';
      return null;
    }
  };
}

function currencyOption(code, displayNames) {
  const name = displayNames?.of(code);
  return el('option', {
    text: code + ' - ' + (name && name !== code ? name : code),
    attrs: { value: code }
  });
}

function timeZoneOption(zone, referenceDate) {
  const offset = formatUtcOffset(getUtcOffsetMinutes(zone, referenceDate));
  return el('option', { text: '(' + offset + ') ' + zone, attrs: { value: zone } });
}

function getUtcOffsetMinutes(zone, date) {
  for (const timeZoneName of ['longOffset', 'shortOffset']) {
    try {
      const part = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName })
        .formatToParts(date)
        .find((item) => item.type === 'timeZoneName');
      const offset = parseOffset(part?.value || '');
      if (offset !== null) return offset;
    } catch {
      // Try the next offset source when this runtime does not support the style.
    }
  }

  try {
    const minuteTimestamp = Math.floor(date.getTime() / 60000) * 60000;
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(new Date(minuteTimestamp));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const localAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute)
    );
    return Math.round((localAsUtc - minuteTimestamp) / 60000);
  } catch {
    return 0;
  }
}

function parseOffset(value) {
  const match = /^(?:GMT|UTC)(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(value);
  if (!match) return null;
  if (!match[1]) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0);
  return match[1] === '-' ? -minutes : minutes;
}

function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const minutes = String(absoluteMinutes % 60).padStart(2, '0');
  return 'UTC' + sign + hours + ':' + minutes;
}
