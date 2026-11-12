import { store } from '../store.js';
import { flash } from '../util.js';

const MESSAGES = {
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/invalid-email': 'Use a username like user@1802.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No internet connection.',
};

export function render(root) {
  root.innerHTML = `
    <section class="card login">
      <h2>Sign in</h2>
      <form id="lf" autocomplete="on">
        <label>Username<input name="login" autocomplete="username" placeholder="user@1802" required autofocus></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="actions"><button type="submit" class="primary">Sign in</button><span class="msg" id="msg"></span></div>
      </form>
    </section>`;

  const form = root.querySelector('#lf');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await store.signIn(form.elements.login.value, form.elements.password.value);
      // The app re-routes automatically once Firebase reports the sign-in.
    } catch (e) {
      flash(root.querySelector('#msg'), MESSAGES[e.code] || e.message, true);
      btn.disabled = false;
    }
  });
}
