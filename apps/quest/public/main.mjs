import * as App from './App.mjs';

const target = document.getElementById('app');
if (target) App.mount(target, { token: target.dataset.token ?? '' });
