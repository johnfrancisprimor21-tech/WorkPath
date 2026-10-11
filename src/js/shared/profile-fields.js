import { el, field, textInput } from './dom.js';

const PAY_FREQUENCIES = [
  ['weekly', 'Weekly'],
  ['biweekly', 'Every two weeks'],
  ['semi_monthly', 'Twice a month'],
  ['monthly', 'Monthly']
];
let listNumber = 0;

export function createPreferenceFields(profile = {}, scope = 'preferences') {
  if (typeof Intl.supportedValuesOf !== 'function') {
    throw new Error('This browser does not support searchable currency and time zone choices. Please update your browser and try again.');
  }

  const currencies = Intl.supportedValuesOf('currency');
  const timeZones = Intl.supportedValuesOf('timeZone');
  const selectedTimeZone = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (selectedTimeZone && !timeZones.includes(selectedTimeZone)) timeZones.push(selectedTimeZone);

  const currencySet = new Set(currencies);
  const timeZoneSet = new Set(timeZones);
  const payFrequencySet = new Set(PAY_FREQUENCIES.map(([value]) => value));
  const suffix = scope + '-' + (++listNumber);
  const currencyListId = 'currency-options-' + suffix;
  const timeZoneListId = 'time-zone-options-' + suffix;
  const container = el('div', { className: 'preference-fields' });

  const currencyInput = textInput({
    type: 'search',
    name: 'currency',
    value: profile.currency ? String(profile.currency).trim() : '',
    placeholder: 'Search currency code',
    autocomplete: 'off',
    list: currencyListId
  });
  currencyInput.spellcheck = false;
  currencyInput.required = true;
  const currencyList = el('datalist', { attrs: { id: currencyListId } });
  let displayNames = null;
  try {
    displayNames = new Intl.DisplayNames([navigator.language], { type: 'currency' });
  } catch {
    displayNames = null;
  }
  for (const code of currencies) {
    const option = el('option', { attrs: { value: code } });
    const name = displayNames?.of(code);
    if (name && name !== code) option.label = code + ' — ' + name;
    currencyList.append(option);
  }
  container.append(field('Currency', currencyInput, { hint: 'Choose a three-letter currency code.' }));
  container.append(currencyList);

  const payFrequency = el('select', { attrs: { name: 'pay_frequency', required: '' } });
  payFrequency.append(el('option', { text: 'Choose a pay frequency', attrs: { value: '' } }));
  for (const [value, label] of PAY_FREQUENCIES) {
    payFrequency.append(el('option', { text: label, attrs: { value } }));
  }
  payFrequency.value = profile.pay_frequency || '';
  container.append(field('Pay frequency', payFrequency));

  const timeZoneInput = textInput({
    type: 'search',
    name: 'timezone',
    value: selectedTimeZone,
    placeholder: 'Search time zone',
    autocomplete: 'off',
    list: timeZoneListId
  });
  timeZoneInput.spellcheck = false;
  timeZoneInput.required = true;
  const timeZoneList = el('datalist', { attrs: { id: timeZoneListId } });
  for (const zone of timeZones) timeZoneList.append(el('option', { attrs: { value: zone } }));
  container.append(field('Time zone', timeZoneInput, { hint: 'Pre-filled from this device; you can change it.' }));
  container.append(timeZoneList);

  return {
    element: container,
    read() {
      return {
        currency: currencyInput.value.trim().toUpperCase(),
        pay_frequency: payFrequency.value,
        timezone: timeZoneInput.value.trim()
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

