import { el, field, makeButton, pageCard } from '../shared/dom.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function renderAuthScreen(options) {
  if (options.confirmationEmail) return renderConfirmationScreen(options);

  const isSignup = options.mode === 'signup';
  const title = isSignup ? 'Create your account' : 'Welcome back';
  const description = isSignup
    ? 'Start with a free Workpath account.'
    : 'Sign in to continue to your workspace.';
  const card = pageCard(title, description);
  const form = el('form', { className: 'form-stack', attrs: { novalidate: '' } });
  const email = el('input', {
    attrs: { type: 'email', autocomplete: 'email', required: '' }
  });
  email.name = 'email';
  email.placeholder = 'you@example.com';
  const password = el('input', {
    attrs: { type: 'password', autocomplete: isSignup ? 'new-password' : 'current-password', required: '' }
  });
  password.name = 'password';
  password.minLength = 8;
  password.placeholder = 'At least 8 characters';
  form.append(field('Email address', email), field('Password', password));

  const feedback = el('p', {
    className: 'status-message status-error',
    attrs: { role: 'alert' }
  });
  const submit = makeButton(isSignup ? 'Create account' : 'Sign in', { type: 'submit', className: 'button button-primary button-wide' });
  form.append(feedback, submit);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    const normalizedEmail = email.value.trim();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      feedback.textContent = 'Enter a valid email address.';
      email.focus();
      return;
    }
    if (password.value.length < 8) {
      feedback.textContent = 'Your password must be at least 8 characters.';
      password.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = isSignup ? 'Creating account…' : 'Signing in…';
    try {
      const result = await options.onSubmit({
        email: normalizedEmail,
        password: password.value,
        mode: options.mode
      });
      if (result && result.confirmationRequired) options.onConfirmation(normalizedEmail);
    } catch (error) {
      feedback.textContent = error.message || 'We could not complete that request. Please try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = isSignup ? 'Create account' : 'Sign in';
    }
  });

  card.append(form);
  const switchText = isSignup ? 'Already have an account?' : 'New to Workpath?';
  const switchLink = el('a', {
    className: 'text-link',
    text: isSignup ? 'Sign in' : 'Create an account',
    attrs: { href: isSignup ? '#/login' : '#/signup' }
  });
  card.append(el('p', { className: 'form-footer' }, [el('span', { text: switchText + ' ' }), switchLink]));
  card.append(localModeChoice(options));
  return el('div', { className: 'page-wrap auth-page' }, [card]);
}

function renderConfirmationScreen(options) {
  const card = pageCard('Check your email', 'One more step before you can use Workpath.');
  card.append(el('p', { className: 'body-copy' }, [
    el('span', { text: 'We sent a confirmation link to ' }),
    el('strong', { text: options.confirmationEmail }),
    el('span', { text: '. Open it to finish creating your account.' })
  ]));
  card.append(el('p', { className: 'muted-copy', text: 'Once confirmed, you can return here and sign in.' }));
  const button = makeButton('Back to sign in', { className: 'button button-primary button-wide' });
  button.addEventListener('click', () => options.onNavigate('/login'));
  card.append(button, localModeChoice(options));
  return el('div', { className: 'page-wrap auth-page' }, [card]);
}

function localModeChoice(options) {
  const feedback = el('p', { className: 'status-message status-error', attrs: { role: 'alert' } });
  feedback.hidden = true;
  const button = makeButton(options.localProfileExists ? 'Continue on this device' : 'Use without an account', {
    className: 'button button-secondary button-wide'
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Opening local data…';
    try {
      await options.onUseLocal();
    } catch (error) {
      button.disabled = false;
      button.textContent = options.localProfileExists ? 'Continue on this device' : 'Use without an account';
      feedback.textContent = error.message || 'We could not open data on this device.';
      feedback.hidden = false;
    }
  });
  return el('section', { className: 'local-mode-choice' }, [
    el('p', { className: 'muted-copy', text: 'Your data is saved only on this device. Clearing your browser data erases it.' }),
    feedback,
    button
  ]);
}

export function authErrorMessage(error, mode) {
  const code = String(error?.code || error?.error_code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (error instanceof TypeError || message.includes('fetch') || message.includes('network')) {
    return 'We could not reach the sign-in service. Check your internet connection and try again.';
  }
  if (code.includes('weak_password') || code.includes('password_too_short') || message.includes('password should be')) {
    return 'Choose a stronger password with at least 8 characters.';
  }
  if (code.includes('user_already_exists') || code.includes('email_exists') || message.includes('already registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (code.includes('email_not_confirmed') || message.includes('email not confirmed')) {
    return 'Please confirm your email using the link we sent before signing in.';
  }
  if (code.includes('invalid_credentials') || message.includes('invalid login credentials')) {
    return 'That email and password combination did not match. Check them and try again.';
  }
  if (mode === 'signup' && (code.includes('signup_disabled') || message.includes('signups not allowed'))) {
    return 'New account registration is currently unavailable. Please try again later.';
  }
  return mode === 'signup'
    ? 'We could not create your account. Check your details and try again.'
    : 'We could not sign you in. Please check your details and try again.';
}
