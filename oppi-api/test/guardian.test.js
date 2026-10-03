'use strict';

/**
 * Tests del Guardián de calidad: la función pura de score
 * (src/lib/profile-score.js). Sin DB: se testea la lógica del score
 * directamente con objetos de entrada.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreProfessional, scoreBusiness } = require('../src/lib/profile-score');

const FULL_PRO = {
  fotoUrl: 'https://oppi.example/foto.jpg',
  bio: 'Soy peluquero con 10 años de experiencia en Asunción',
  hasPricedService: true,
  hasCategory: true,
  barrio: 'Villa Morra',
  hasAvailability: true,
};

const FULL_BIZ = {
  logoUrl: 'https://oppi.example/logo.png',
  description: 'Barbería clásica en el centro de Asunción',
  hasService: true,
  hasSchedule: true,
  addressOrBarrio: 'Palma 123, Centro',
};

const EMPTY_PRO = {
  fotoUrl: '', bio: '', hasPricedService: false,
  hasCategory: false, barrio: '', hasAvailability: false,
};

const EMPTY_BIZ = {
  logoUrl: '', description: '', hasService: false,
  hasSchedule: false, addressOrBarrio: '',
};

test('profesional completo → 100 y sin faltantes', () => {
  const { score, missing } = scoreProfessional(FULL_PRO);
  assert.equal(score, 100);
  assert.deepEqual(missing, []);
});

test('profesional vacío → 0 y 6 faltantes ordenados por peso', () => {
  const { score, missing } = scoreProfessional(EMPTY_PRO);
  assert.equal(score, 0);
  assert.deepEqual(missing.map((m) => m.key),
    ['service', 'photo', 'bio', 'category', 'barrio', 'availability']);
  assert.deepEqual(missing.map((m) => m.weight), [25, 20, 20, 15, 10, 10]);
});

test('profesional parcial: solo foto y bio → 40, top 2 = servicio y categoría', () => {
  const { score, missing } = scoreProfessional({
    ...EMPTY_PRO, fotoUrl: 'f.jpg', bio: 'Peluquero con 10 años de oficio en Asunción',
  });
  assert.equal(score, 40);
  assert.equal(missing[0].key, 'service');
  assert.equal(missing[1].key, 'category');
});

test('bio con exactamente 20 caracteres cuenta; 19 no', () => {
  assert.equal(scoreProfessional({ ...EMPTY_PRO, bio: 'x'.repeat(20) }).score, 20);
  assert.equal(scoreProfessional({ ...EMPTY_PRO, bio: 'x'.repeat(19) }).score, 0);
});

test('bio con espacios en blanco no cuenta', () => {
  assert.equal(scoreProfessional({ ...EMPTY_PRO, bio: '   ' }).score, 0);
});

test('foto con espacios en blanco no cuenta', () => {
  assert.equal(scoreProfessional({ ...EMPTY_PRO, fotoUrl: '  ' }).score, 0);
});

test('negocio completo → 100 y sin faltantes', () => {
  const { score, missing } = scoreBusiness(FULL_BIZ);
  assert.equal(score, 100);
  assert.deepEqual(missing, []);
});

test('negocio vacío → 0 y faltantes por peso', () => {
  const { score, missing } = scoreBusiness(EMPTY_BIZ);
  assert.equal(score, 0);
  assert.deepEqual(missing.map((m) => m.key),
    ['service', 'logo', 'description', 'schedule', 'address']);
});

test('negocio sin logo ni descripción → 60, top 2 = logo y descripción', () => {
  const { score, missing } = scoreBusiness({ ...FULL_BIZ, logoUrl: '', description: '' });
  assert.equal(score, 60);
  assert.deepEqual(missing.slice(0, 2).map((m) => m.key), ['logo', 'description']);
});

test('los CTAs vienen en voseo rioplatense', () => {
  const { missing } = scoreProfessional(EMPTY_PRO);
  const ctas = missing.map((m) => m.cta).join(' ');
  assert.match(ctas, /Subí|Escribí|Publicá|Elegí|Indicá|Abrí/);
  const { missing: bizMissing } = scoreBusiness(EMPTY_BIZ);
  assert.match(bizMissing.map((m) => m.cta).join(' '), /Subí|Cargá/);
});

test('input ausente o parcial no rompe', () => {
  assert.equal(scoreProfessional().score, 0);
  assert.equal(scoreBusiness({}).score, 0);
  assert.equal(scoreProfessional({ bio: 'Bio larguísima con más de veinte caracteres sí' }).score, 20);
});
