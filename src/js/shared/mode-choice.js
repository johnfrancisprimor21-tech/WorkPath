import { el } from './dom.js';

export function createModeChoice(selectedMode, legendText) {
  const fieldset = el('fieldset', { className: 'mode-choice' });
  fieldset.append(el('legend', { text: legendText }));
  const options = [
    ['employed', 'Employed', 'Track work days, shifts, and pay.'],
    ['job_seeker', 'Job Seeker', 'Track applications and interview progress.']
  ];
  for (const [value, label, description] of options) {
    const input = el('input', { attrs: { type: 'radio', name: 'mode', value } });
    input.checked = selectedMode === value;
    input.required = true;
    const choiceLabel = el('label', { className: 'mode-card' }, [
      input,
      el('span', { className: 'mode-card-content' }, [
        el('strong', { text: label }),
        el('small', { text: description })
      ])
    ]);
    fieldset.append(choiceLabel);
  }
  return {
    element: fieldset,
    read() {
      return fieldset.querySelector('input[name="mode"]:checked')?.value || '';
    }
  };
}
