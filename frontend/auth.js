/**
 * ============================================================================
 * REFUND — Login & Sign-Up Controller (auth.js)
 * Integrated with `supabase-config.js` and `returns-trade-agent-main` schema:
 *   - Sign-in (`supabase.auth.signInWithPassword`) + Demo Bypass -> store.html
 *   - Sign-up (`supabase.auth.signUp` passing `full_name` & `phone` in `data`
 *     for `public.profiles` trigger `handle_new_user()`)
 *   - Social OAuth (`supabase.auth.signInWithOAuth` for google, apple, facebook)
 *   - Password Reset (`supabase.auth.resetPasswordForEmail`)
 *   - Magic Link OTP (`supabase.auth.signInWithOtp`)
 * ============================================================================
 */

const authState = {
  mode: 'signin', // 'signin' | 'signup'
};

function getRedirectUrl(path = 'store.html') {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  if (window.location.protocol === 'file:') {
    return `http://127.0.0.1:3000${cleanPath}`;
  }
  return `${window.location.origin}${cleanPath}`;
}

const supabaseAuthClient = window.RefundBackend?.supabaseClient || null;

// DOM Elements
const authTitle = document.getElementById('auth-title');
const authSubtitle = document.getElementById('auth-subtitle');
const signupExtraFields = document.getElementById('signup-extra-fields');
const fullNameInput = document.getElementById('full-name');
const phoneInput = document.getElementById('phone');
const loginForm = document.getElementById('login-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const togglePasswordBtn = document.getElementById('toggle-password');
const iconEye = document.getElementById('icon-eye');
const iconEyeOff = document.getElementById('icon-eye-off');

const submitBtn = document.getElementById('submit-btn');
const submitSpinner = document.getElementById('submit-spinner');
const submitText = document.getElementById('submit-text');

const forgotPasswordLink = document.getElementById('forgot-password-link');
const magicLinkBtn = document.getElementById('magic-link-btn');
const toggleAuthModeLink = document.getElementById('toggle-auth-mode-link');
const authFooterText = document.getElementById('auth-footer-text');
const socialButtons = document.querySelectorAll('.btn-social[data-provider]');

const feedbackAlert = document.getElementById('feedback-alert');
const feedbackIcon = document.getElementById('feedback-icon');
const feedbackMessage = document.getElementById('feedback-message');

const ALERT_ICONS = {
  error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
};

function showFeedback(type, message) {
  if (!feedbackAlert) return;
  feedbackAlert.classList.remove('is-error', 'is-success');
  feedbackAlert.classList.add(type === 'success' ? 'is-success' : 'is-error');
  if (feedbackIcon) feedbackIcon.innerHTML = ALERT_ICONS[type] || ALERT_ICONS.error;
  if (feedbackMessage) feedbackMessage.textContent = message;
  feedbackAlert.hidden = false;
}

function clearFeedback() {
  if (!feedbackAlert) return;
  feedbackAlert.hidden = true;
  if (feedbackMessage) feedbackMessage.textContent = '';
}

function setLoadingState(isLoading, loadingLabel = 'Signing in...') {
  if (submitBtn) submitBtn.disabled = isLoading;
  socialButtons.forEach((btn) => {
    btn.disabled = isLoading;
  });

  if (isLoading) {
    if (submitSpinner) submitSpinner.hidden = false;
    if (submitText) submitText.textContent = loadingLabel;
  } else {
    if (submitSpinner) submitSpinner.hidden = true;
    if (submitText) {
      submitText.textContent = authState.mode === 'signup' ? 'Create Account' : 'Continue';
    }
  }
}

function getValidatedEmail(missingPromptMessage = 'Please enter your email address.') {
  const email = (emailInput?.value || '').trim();
  if (!email) {
    showFeedback('error', missingPromptMessage);
    emailInput?.focus();
    return null;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showFeedback('error', 'Please enter a valid email address (e.g., you@company.com).');
    emailInput?.focus();
    return null;
  }

  return email;
}

// ============================================================================
// 1. PASSWORD VISIBILITY TOGGLE (Single Eye / Eye-Off Icon)
// ============================================================================
if (togglePasswordBtn && passwordInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.setAttribute('aria-pressed', String(isPassword));
    togglePasswordBtn.setAttribute(
      'aria-label',
      isPassword ? 'Hide password' : 'Show password'
    );
    iconEye?.classList.toggle('is-hidden', isPassword);
    iconEyeOff?.classList.toggle('is-hidden', !isPassword);
  });
}

// ============================================================================
// 2. TOGGLE SIGN-IN / SIGN-UP MODE ("No account yet? Create one")
// ============================================================================
function updateAuthModeUI() {
  clearFeedback();
  const isSignUp = authState.mode === 'signup';
  if (signupExtraFields) signupExtraFields.hidden = !isSignUp;

  if (authTitle) {
    authTitle.textContent = isSignUp ? 'Create your Refund account' : 'Sign in to Refund';
  }
  if (authSubtitle) {
    authSubtitle.textContent = isSignUp
      ? 'Sign up with your email to link your shop orders and returns.'
      : 'Welcome back. Sign in with your social account or email.';
  }
  if (submitText) {
    submitText.textContent = isSignUp ? 'Create Account' : 'Continue';
  }
  if (authFooterText) {
    authFooterText.innerHTML = isSignUp
      ? `Already have an account? <a href="#sign-in" id="toggle-auth-mode-link" class="create-account-link">Sign in</a>`
      : `No account yet? <a href="#create-account" id="toggle-auth-mode-link" class="create-account-link">Create one</a>`;
    document.getElementById('toggle-auth-mode-link')?.addEventListener('click', handleToggleMode);
  }
}

function handleToggleMode(event) {
  event.preventDefault();
  authState.mode = authState.mode === 'signin' ? 'signup' : 'signin';
  updateAuthModeUI();
}

toggleAuthModeLink?.addEventListener('click', handleToggleMode);

// ============================================================================
// 3. DEMO & LIVE SESSION REDIRECT HELPER
// ============================================================================
function completeLoginAndRedirect(user, label = 'Signed in') {
  const email = user?.email || '';
  window.RefundBackend?.setDemoSessionUser({
    id: user?.id,
    email,
    user_metadata: user?.user_metadata || {},
  });
  showFeedback('success', `${label} as ${email}. Redirecting to store...`);
  setTimeout(() => {
    window.location.href = window.SUPABASE_CONFIG?.STORE_PAGE || 'store.html';
  }, 550);
}

function demoUser(email, fullName, phone) {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    email,
    user_metadata: { full_name: fullName, phone },
  };
}

// ============================================================================
// 4. EMAIL & PASSWORD SIGN-IN / SIGN-UP
// ============================================================================
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFeedback();

    const email = getValidatedEmail('Please enter your email address.');
    if (!email) return;

    const password = passwordInput?.value || '';
    if (!password || password.length < 6) {
      showFeedback('error', 'Please enter a password (at least 6 characters per config.toml).');
      passwordInput?.focus();
      return;
    }

    const fullName = (fullNameInput?.value || '').trim() || email.split('@')[0];
    const phone = (phoneInput?.value || '').trim() || '+27 82 000 0000';

    setLoadingState(
      true,
      authState.mode === 'signup' ? 'Creating account...' : 'Signing in...'
    );

    try {
      // Live Supabase Auth when configured. Do not fall through to the demo user.
      if (supabaseAuthClient) {
        if (authState.mode === 'signup') {
          const { data, error } = await supabaseAuthClient.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: getRedirectUrl('index.html'),
              data: {
                full_name: fullName,
                phone,
              },
            },
          });
          if (error) {
            showFeedback('error', error.message);
            return;
          }
          // Confirmation off (local) returns a session. Confirmation on (hosted)
          // returns the user and no session.
          if (data?.session?.user) {
            completeLoginAndRedirect(data.session.user, 'Account created');
            return;
          }
          if (data?.user) {
            showFeedback(
              'success',
              `Account created for ${email}. Check your email to confirm it, then sign in.`
            );
            return;
          }
          showFeedback('error', 'Sign up did not return a user.');
          return;
        }

        const { data, error } = await supabaseAuthClient.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          await window.RefundBackend?.logAuthEvent?.('sign_in_failed', email);
          showFeedback('error', error.message);
          return;
        }
        if (data?.session?.user) {
          completeLoginAndRedirect(data.session.user, 'Signed in');
          return;
        }
        showFeedback('error', 'Sign in did not return a session.');
        return;
      }

      // Demo Login Bypass (when testing locally without live Supabase keys)
      await new Promise((r) => setTimeout(r, 400));
      completeLoginAndRedirect(
        demoUser(email, fullName, phone),
        authState.mode === 'signup' ? 'Demo Account Created' : 'Signed in (Demo Mode)'
      );
    } catch (err) {
      showFeedback('error', err?.message || 'An unexpected error occurred.');
    } finally {
      setLoadingState(false);
    }
  });
}

// ============================================================================
// 5. SOCIAL OAUTH SIGN-IN (Google, iCloud / Apple, Facebook)
// ============================================================================
socialButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    clearFeedback();
    const provider = button.getAttribute('data-provider');
    if (!provider) return;

    const providerNames = {
      google: 'Google',
      apple: 'iCloud / Apple',
      facebook: 'Facebook',
    };

    setLoadingState(true, `Connecting to ${providerNames[provider] || provider}...`);

    try {
      if (supabaseAuthClient) {
        const { error } = await supabaseAuthClient.auth.signInWithOAuth({
          provider,
          options: {
            redirectTo: getRedirectUrl(window.SUPABASE_CONFIG?.STORE_PAGE || 'store.html'),
          },
        });
        if (error) {
          showFeedback('error', error.message);
          setLoadingState(false);
        }
        return;
      }

      // Demo OAuth sign-in when running without live OAuth secrets
      await new Promise((r) => setTimeout(r, 450));
      completeLoginAndRedirect(
        demoUser(
          'customer.one@example.com',
          `Customer One (${providerNames[provider]})`,
          '+27 82 111 2222'
        ),
        `Authenticated via ${providerNames[provider]}`
      );
    } catch (err) {
      showFeedback('error', err?.message || 'Unable to initiate social sign-in.');
      setLoadingState(false);
    }
  });
});

// ============================================================================
// 6. FORGOT PASSWORD (`supabase.auth.resetPasswordForEmail`)
// ============================================================================
forgotPasswordLink?.addEventListener('click', async (event) => {
  event.preventDefault();
  clearFeedback();

  const email = getValidatedEmail('Enter your email address above so we can send a password reset link.');
  if (!email) return;

  setLoadingState(true, 'Sending reset email...');
  try {
    if (supabaseAuthClient) {
      const { error } = await supabaseAuthClient.auth.resetPasswordForEmail(email, {
        redirectTo: getRedirectUrl('index.html'),
      });
      if (error) {
        showFeedback('error', error.message);
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 350));
    }
    showFeedback(
      'success',
      `Password reset instructions have been sent to ${email}. Check your inbox.`
    );
  } catch (err) {
    showFeedback('error', err?.message || 'Could not send password reset email.');
  } finally {
    setLoadingState(false);
  }
});

// ============================================================================
// 7. MAGIC LINK (`supabase.auth.signInWithOtp`)
// ============================================================================
magicLinkBtn?.addEventListener('click', async (event) => {
  event.preventDefault();
  clearFeedback();

  const email = getValidatedEmail('Enter your email address above to receive a magic sign-in link.');
  if (!email) return;

  setLoadingState(true, 'Sending sign-in link...');
  try {
    if (supabaseAuthClient) {
      const { error } = await supabaseAuthClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: getRedirectUrl(window.SUPABASE_CONFIG?.STORE_PAGE || 'store.html'),
        },
      });
      if (error) {
        showFeedback('error', error.message);
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 350));
    }
    showFeedback(
      'success',
      `Magic sign-in link sent to ${email}! Click the link in your email to sign in.`
    );
  } catch (err) {
    showFeedback('error', err?.message || 'Could not send magic sign-in link.');
  } finally {
    setLoadingState(false);
  }
});

[emailInput, passwordInput].forEach((input) => {
  input?.addEventListener('input', () => {
    if (feedbackAlert && !feedbackAlert.hidden && feedbackAlert.classList.contains('is-error')) {
      clearFeedback();
    }
  });
});

// ============================================================================
// 8. PASSWORD RECOVERY + ALREADY-SIGNED-IN REDIRECT
// ============================================================================
const resetPasswordForm = document.getElementById('reset-password-form');
const initialHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const isRecovery = initialHash.get('type') === 'recovery';

function showRecoveryForm() {
  if (loginForm) loginForm.hidden = true;
  document.querySelector('.social-buttons')?.setAttribute('hidden', '');
  document.querySelector('.divider')?.setAttribute('hidden', '');
  document.querySelector('.magic-link-row')?.setAttribute('hidden', '');
  document.querySelector('.auth-footer')?.setAttribute('hidden', '');
  if (resetPasswordForm) resetPasswordForm.hidden = false;
  if (authTitle) authTitle.textContent = 'Choose a new password';
  if (authSubtitle) authSubtitle.textContent = 'Enter a new password for your Refund account.';
}

if (isRecovery) showRecoveryForm();

resetPasswordForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback();
  const nextPassword = document.getElementById('new-password')?.value || '';
  if (nextPassword.length < 6) {
    showFeedback('error', 'Please enter a password (at least 6 characters).');
    return;
  }
  if (!supabaseAuthClient) {
    showFeedback('error', 'Password reset needs a configured Supabase project.');
    return;
  }
  const { error } = await supabaseAuthClient.auth.updateUser({ password: nextPassword });
  if (error) {
    showFeedback('error', error.message);
    return;
  }
  showFeedback('success', 'Password updated. Taking you to the store...');
  setTimeout(() => {
    window.location.href = window.SUPABASE_CONFIG?.STORE_PAGE || 'store.html';
  }, 600);
});

if (!isRecovery && supabaseAuthClient) {
  supabaseAuthClient.auth.getSession().then(({ data }) => {
    if (data?.session) {
      window.location.href = window.SUPABASE_CONFIG?.STORE_PAGE || 'store.html';
    }
  });
}
