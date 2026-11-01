import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script = readFileSync('site/scripts/hero-atmosphere.js', 'utf8');
function harness(localTime, {hasHero = true, observer = true} = {}) {
  let time = Date.parse(`2026-11-01T${localTime}+07:00`);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  const classes = new Set();
  const classList = {toggle(name, value) { value ? classes.add(name) : classes.delete(name); }};
  const html = {dataset: {}, classList};
  const nodes = new Map();
  const docEvents = {}, windowEvents = {}, timers = new Map();
  let sequence = 0, observe;
  const hero = {classList, querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {style: {}});
    return nodes.get(selector);
  }};
  const document = {documentElement: html, readyState: 'loading', hidden: false,
    querySelector: () => hasHero ? hero : null,
    addEventListener: (name, fn) => { docEvents[name] = fn; }};
  const window = {setTimeout(fn, delay) { timers.set(++sequence, {fn, delay}); return sequence; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener: (name, fn) => { windowEvents[name] = fn; }};
  class Observer { constructor(fn) { observe = fn; } observe() {} }
  if (observer) window.IntersectionObserver = Observer;
  vm.runInNewContext(script, {document, window, Date: Clock, IntersectionObserver: Observer});
  return {html, nodes, classes, timers, document, windowEvents, docEvents,
    init: () => docEvents.DOMContentLoaded(),
    setTime: t => { time = Date.parse(`2026-11-01T${t}+07:00`); },
    visibility: hidden => { document.hidden = hidden; docEvents.visibilitychange(); },
    intersect: isIntersecting => observe([{isIntersecting}])};
}

test('hero: Abakan day, night, midnight and half-hour transitions', () => {
  for (const [time, phase, amount] of [
    ['00:00:00', 'night', 1], ['07:29:59', 'night', 1], ['07:30:00', 'night', 1],
    ['07:45:00', 'twilight', .5], ['08:00:00', 'day', 0], ['12:00:00', 'day', 0],
    ['20:00:00', 'day', 0], ['20:15:00', 'twilight', .5], ['20:30:00', 'night', 1],
    ['23:59:59', 'night', 1]
  ]) {
    const h = harness(time);
    assert.equal(h.html.dataset.heroPhase, phase, `${time} before DOM`);
    h.init();
    assert.equal(h.nodes.get('.hero__night-sky').style.opacity, String(amount), time);
    assert.equal(h.nodes.get('.hero__sun').style.opacity, String(1 - amount), time);
    assert.equal(h.classes.has('hero-night'), amount >= .5, time);
  }
});

test('hero: hidden tab pauses motion and timers; resume and BFCache resync time', () => {
  const h = harness('12:00:00'); h.init();
  assert.equal(h.timers.size, 1);
  h.visibility(true);
  assert.equal(h.timers.size, 0);
  assert(h.classes.has('is-atmosphere-paused'));
  h.setTime('23:00:00'); h.visibility(false);
  assert.equal(h.html.dataset.heroPhase, 'night');
  assert.equal(h.timers.size, 1);
  h.intersect(false); assert(h.classes.has('is-atmosphere-paused'));
  h.intersect(true); assert(!h.classes.has('is-atmosphere-paused'));
  h.windowEvents.pagehide(); assert.equal(h.timers.size, 0);
  h.setTime('12:00:00'); h.windowEvents.pageshow();
  assert.equal(h.html.dataset.heroPhase, 'day'); assert.equal(h.timers.size, 1);
});

test('hero: minute boundary updates without accumulating timers', () => {
  const h = harness('19:59:50'); h.init();
  assert.equal([...h.timers.values()][0].delay, 10030);
  const timer = [...h.timers.values()][0];
  h.setTime('20:15:00'); timer.fn();
  assert.equal(h.html.dataset.heroPhase, 'twilight');
  assert.equal(h.timers.size, 1);
});

test('hero: absent hero and absent IntersectionObserver are safe', () => {
  const empty = harness('23:00:00', {hasHero: false}); empty.init();
  assert.equal(empty.timers.size, 0);
  const fallback = harness('12:00:00', {observer: false}); fallback.init();
  assert.equal(fallback.html.dataset.heroPhase, 'day');
});
