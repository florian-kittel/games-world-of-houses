// Update lifecycle regression: installed workers must not reload stale scripts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');
const start = source.indexOf('  function registerServiceWorker()');
const end = source.indexOf('  registerServiceWorker();', start);
async function setup(controlled) {
  const events = {}, workerEvents = {}, registrationEvents = {};
  let reloads = 0, activations = 0;
  const installing = { state: 'installing', addEventListener(name, fn) { workerEvents[name] = fn; },
    postMessage(message) { assert.equal(message, 'skipWaiting'); activations++; } };
  const registration = { installing, waiting: installing,
    addEventListener(name, fn) { registrationEvents[name] = fn; } };
  const serviceWorker = { controller: controlled ? {} : null,
    addEventListener(name, fn) { events[name] = fn; },
    register(url, options) {
      assert.equal(url, 'sw.js'); assert.equal(options.updateViaCache, 'none');
      return Promise.resolve(registration);
    } };
  const window = { addEventListener(name, fn) { events[name] = fn; }, location: { reload() { reloads++; } } };
  vm.runInNewContext(source.slice(start, end) + '\nregisterServiceWorker();', {
    window, navigator: { serviceWorker }, location: { protocol: 'https:' }
  });
  events.load();
  await Promise.resolve();
  assert.equal(activations, 1, 'Activate an already waiting update');
  registrationEvents.updatefound();
  return { events, workerEvents, installing, serviceWorker, reloads: () => reloads };
}
(async () => {
  const update = await setup(true);
  update.installing.state = 'installed';
  update.workerEvents.statechange();
  assert.equal(update.reloads(), 0, 'Do not reload while the old cache still controls the page');
  update.events.controllerchange();
  assert.equal(update.reloads(), 1, 'Reload after the new worker takes control');
  update.events.controllerchange();
  assert.equal(update.reloads(), 1, 'Reload at most once');
  const first = await setup(false);
  first.serviceWorker.controller = {};
  first.events.controllerchange();
  assert.equal(first.reloads(), 0, 'First installation does not interrupt a new game');
  first.events.controllerchange();
  assert.equal(first.reloads(), 1, 'A later update in the same session still reloads');
  console.log('PASS: waiting updates activate, reload follows control transfer only, first install and duplicate events handled.');
})().catch(error => { console.error(error); process.exitCode = 1; });
