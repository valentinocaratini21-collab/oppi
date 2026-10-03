/* ============================================================================
 * Oppi — Datos semilla (mock)
 * ----------------------------------------------------------------------------
 * Estos datos alimentan el adaptador mock de js/api.js para que la web
 * funcione sin backend. Cuando el backend real esté listo, este archivo
 * deja de usarse: el adaptador REST va a traer todo de la API.
 * ========================================================================== */
'use strict';

/* ============================================================================
 * Flags de producto de la web (los prende/apaga el dueño sin deploy).
 * FEATURE_MAP: muestra el mapa de profesionales/chambas. En pausa
 * (false): se ocultan el tab "Mapa", los tabs Lista|Mapa y los botones de
 * ubicación; el código del mapa (js/views-map.js, #/mapa) queda intacto.
 * ========================================================================== */
const OppiConfig = { FEATURE_MAP: false };

const OPPI_SEED = {
  categories: [
    { id: 'belleza',    name: 'Belleza',      icon: '💇' },
    { id: 'hogar',      name: 'Hogar',        icon: '🏠' },
    { id: 'mascotas',   name: 'Mascotas',     icon: '🐾' },
    { id: 'clases',     name: 'Clases',       icon: '📚' },
    { id: 'eventos',    name: 'Eventos',      icon: '📸' },
    { id: 'bienestar',   name: 'Bienestar',    icon: '💆' },
  ],

  taskCategories: [
    { id: 'plomeria',     name: 'Plomería',      icon: '🔧' },
    { id: 'electricidad', name: 'Electricidad',  icon: '💡' },
    { id: 'pintura',      name: 'Pintura',       icon: '🎨' },
    { id: 'limpieza',     name: 'Limpieza',      icon: '🧹' },
    { id: 'mudanza',      name: 'Mudanza',       icon: '📦' },
    { id: 'jardin',       name: 'Jardín',        icon: '🌿' },
    { id: 'otros',        name: 'Otros',         icon: '🛠️' },
  ],

  barrios: ['Villa Morra', 'Carmelitas', 'Las Mercedes', 'Sajonia', 'Recoleta', 'Trinidad', 'Loma Pytá', 'San Vicente'],

  professionals: [
    {
      lat: -25.2857, lng: -57.5822, id: 'p1', name: 'Camila Duarte', initials: 'CD', color: '#8B5CF6',
      category: 'belleza', specialty: 'Peluquera colorista', barrio: 'Villa Morra',
      address: 'Av. Mariscal López 1234', rating: 4.9, reviewsCount: 132,
      verified: true, about: 'Colorista con 8 años de experiencia. Me especializo en balayage y correcciones de color. Trabajo solo con productos profesionales.',
      services: [
        { id: 'p1s1', name: 'Corte + peinado', price: 90000, durationMin: 45 },
        { id: 'p1s2', name: 'Balayage completo', price: 450000, durationMin: 180 },
        { id: 'p1s3', name: 'Tratamiento keratina', price: 280000, durationMin: 120 },
      ],
      reviews: [
        { author: 'Sofía R.', rating: 5, date: '2026-09-20', text: 'El balayage me quedó increíble, tal cual la foto que llevé. Re puntual.', reply: 'Gracias, Sofi! Me alegra que te haya encantado. Te espero para el retoque 💜' },
        { author: 'Marta G.', rating: 5, date: '2026-09-12', text: 'Vuelvo siempre. Se nota que sabe muchísimo de color.' },
      ],
    },
    {
      lat: -25.2842, lng: -57.5928, id: 'p2', name: 'Rodrigo "Rolo" Benítez', initials: 'RB', color: '#3B82F6',
      category: 'belleza', specialty: 'Barbero', barrio: 'Carmelitas',
      address: 'Av. San Martín 567', rating: 4.8, reviewsCount: 98,
      verified: true, about: 'Barbero clásico y moderno. Degradados precisos, afeitado navaja y diseño de barba.',
      services: [
        { id: 'p2s1', name: 'Corte degradado', price: 70000, durationMin: 40 },
        { id: 'p2s2', name: 'Corte + barba', price: 110000, durationMin: 60 },
      ],
      reviews: [
        { author: 'Diego A.', rating: 5, date: '2026-09-18', text: 'El mejor degradado que me hicieron en Asunción.' },
      ],
    },
    {
      lat: -25.2967, lng: -57.5892, id: 'p3', name: 'Lucía Ferreira', initials: 'LF', color: '#EC4899',
      category: 'belleza', specialty: 'Manicurista', barrio: 'Las Mercedes',
      address: 'Calle Lillo 890', rating: 4.9, reviewsCount: 210,
      verified: true, about: 'Nail artist. Esmaltado semipermanente, kapping y diseños a mano alzada. Atiendo a domicilio.',
      services: [
        { id: 'p3s1', name: 'Semipermanente', price: 120000, durationMin: 90 },
        { id: 'p3s2', name: 'Kapping + semi', price: 160000, durationMin: 120 },
      ],
      reviews: [
        { author: 'Paola M.', rating: 5, date: '2026-09-25', text: 'Me duraron 4 semanas intactas. Una genia.' },
      ],
    },
    {
      lat: -25.2919, lng: -57.6063, id: 'p4', name: 'Hugo Vera', initials: 'HV', color: '#F59E0B',
      category: 'hogar', specialty: 'Electricista', barrio: 'Sajonia',
      address: 'Av. Carlos A. López 345', rating: 4.7, reviewsCount: 76,
      verified: true, about: 'Electricista matriculado. Instalaciones, tableros, aires acondicionados y urgencias.',
      services: [
        { id: 'p4s1', name: 'Visita + diagnóstico', price: 80000, durationMin: 60 },
        { id: 'p4s2', name: 'Instalación de aire', price: 350000, durationMin: 180 },
      ],
      reviews: [
        { author: 'Carlos P.', rating: 5, date: '2026-09-10', text: 'Vino el mismo día y dejó todo funcionando. Recomendado.' },
      ],
    },
    {
      lat: -25.3168, lng: -57.5604, id: 'p5', name: 'María José Aquino', initials: 'MA', color: '#10B981',
      category: 'hogar', specialty: 'Limpieza profesional', barrio: 'Recoleta',
      address: 'Av. Eusebio Ayala 2100', rating: 4.9, reviewsCount: 187,
      verified: true, about: 'Limpieza profunda de hogares y oficinas. Llevo mis propios productos. Equipo de 2 personas disponible.',
      services: [
        { id: 'p5s1', name: 'Limpieza profunda (depto)', price: 220000, durationMin: 240 },
        { id: 'p5s2', name: 'Limpieza post-obra', price: 380000, durationMin: 360 },
      ],
      reviews: [
        { author: 'Andrea S.', rating: 5, date: '2026-09-22', text: 'Mi depto quedó como nuevo. No falta un detalle.' },
      ],
    },
    {
      lat: -25.3058, lng: -57.571, id: 'p6', name: 'Fernando Galeano', initials: 'FG', color: '#6366F1',
      category: 'hogar', specialty: 'Plomero', barrio: 'Trinidad',
      address: 'Av. Artigas 1500', rating: 4.6, reviewsCount: 64,
      verified: false, about: 'Plomería en general: canillas, inodoros, desagues y termotanques.',
      services: [
        { id: 'p6s1', name: 'Reparación de canilla', price: 90000, durationMin: 60 },
      ],
      reviews: [
        { author: 'Luis T.', rating: 4, date: '2026-09-05', text: 'Buen trabajo, tardó un poco más de lo previsto.' },
      ],
    },
    {
      lat: -25.2811, lng: -57.5785, id: 'p7', name: 'Nadia López', initials: 'NL', color: '#14B8A6',
      category: 'bienestar', specialty: 'Masoterapeuta', barrio: 'Villa Morra',
      address: 'Charles de Gaulle 456', rating: 5.0, reviewsCount: 143,
      verified: true, about: 'Masajes descontracturantes, relajantes y deportivos. Camilla profesional a domicilio.',
      services: [
        { id: 'p7s1', name: 'Masaje descontracturante (60 min)', price: 180000, durationMin: 60 },
        { id: 'p7s2', name: 'Masaje relajante (90 min)', price: 250000, durationMin: 90 },
      ],
      reviews: [
        { author: 'Caro B.', rating: 5, date: '2026-09-28', text: 'Salí renovada. Manos mágicas, en serio.' },
      ],
    },
    {
      lat: -25.2879, lng: -57.5961, id: 'p8', name: 'Pedro Ozuna', initials: 'PO', color: '#F97316',
      category: 'mascotas', specialty: 'Paseador canino', barrio: 'Carmelitas',
      address: 'Parque de la Salud', rating: 4.9, reviewsCount: 88,
      verified: true, about: 'Paseos en manadas chicas (máx 4 perros) por el Parque de la Salud. Fotos y reporte en cada paseo.',
      services: [
        { id: 'p8s1', name: 'Paseo 1 hora', price: 50000, durationMin: 60 },
        { id: 'p8s2', name: 'Pack 10 paseos', price: 450000, durationMin: 60 },
      ],
      reviews: [
        { author: 'Vale C.', rating: 5, date: '2026-09-15', text: 'Mi perro lo ama. Manda fotos siempre.' },
      ],
    },
    {
      lat: -25.2994, lng: -57.5855, id: 'p9', name: 'Teacher Ana', initials: 'TA', color: '#0EA5E9',
      category: 'clases', specialty: 'Profesora de inglés', barrio: 'Las Mercedes',
      address: 'Online / a domicilio', rating: 4.8, reviewsCount: 52,
      verified: true, about: 'Inglés conversacional y preparación para entrevistas. Clases online o a domicilio.',
      services: [
        { id: 'p9s1', name: 'Clase conversacional (1h)', price: 100000, durationMin: 60 },
      ],
      reviews: [
        { author: 'Jorge M.', rating: 5, date: '2026-09-08', text: 'En 2 meses mejoré muchísimo mi speaking.' },
      ],
    },
    {
      lat: -25.2935, lng: -57.6012, id: 'p10', name: 'Bruno Cáceres', initials: 'BC', color: '#A855F7',
      category: 'eventos', specialty: 'Fotógrafo', barrio: 'Sajonia',
      address: 'A domicilio', rating: 4.9, reviewsCount: 41,
      verified: true, about: 'Fotografía de eventos, retratos y producto. Entrega digital en 72h.',
      services: [
        { id: 'p10s1', name: 'Sesión retrato (1h)', price: 300000, durationMin: 60 },
        { id: 'p10s2', name: 'Cobertura evento (4h)', price: 900000, durationMin: 240 },
      ],
      reviews: [
        { author: 'Dani F.', rating: 5, date: '2026-09-19', text: 'Las fotos de mi cumple quedaron espectaculares.' },
      ],
    },
  ],

  tasks: [
    {
      id: 't1', lat: -25.2915, lng: -57.5745, title: 'Se me rompió la canilla de la cocina, pierde agua',
      category: 'plomeria', description: 'La canilla monocomando de la cocina pierde agua todo el tiempo. Necesito que la cambien o reparen esta semana.',
      barrio: 'Villa Morra', budgetMin: 80000, budgetMax: 150000, urgent: true,
      photos: [], status: 'open', createdBy: 'me', createdAt: '2026-09-29',
      offers: [
        { id: 't1o1', handymanId: 'h1', handymanName: 'Miguel Ángel Sosa', rating: 4.8, jobs: 45, amount: 120000, message: 'Voy mañana a la mañana con repuestos. Te dejo garantía escrita.', status: 'pending' },
        { id: 't1o2', handymanId: 'h2', handymanName: 'Juan Pereira', rating: 4.5, jobs: 23, amount: 95000, message: 'Puedo pasar hoy a la tarde a verlo.', status: 'pending' },
      ],
    },
    {
      id: 't2', lat: -25.2710, lng: -57.5800, title: 'Pintar una pieza de 4x4',
      category: 'pintura', description: 'Pieza de 4x4 metros, quiero pintarla de blanco. Yo compro la pintura, necesito solo mano de obra.',
      barrio: 'Carmelitas', budgetMin: 300000, budgetMax: 450000, urgent: false,
      photos: [], status: 'open', createdBy: 'me', createdAt: '2026-09-28',
      offers: [
        { id: 't2o1', handymanId: 'h3', handymanName: 'Ramón Fleitas', rating: 4.9, jobs: 67, amount: 380000, message: 'Dos días de trabajo, dejo todo encintado y limpio.', status: 'pending' },
      ],
    },
    {
      id: 't3', lat: -25.2790, lng: -57.5860, title: 'El aire no enfría, tira aire caliente',
      category: 'electricidad', description: 'Split de 12000 BTU, de un día para otro dejó de enfriar. Seguro le falta gas o es el capacitor.',
      barrio: 'Las Mercedes', budgetMin: 150000, budgetMax: 300000, urgent: true,
      photos: [], status: 'open', createdBy: 'other', createdAt: '2026-09-30',
      offers: [],
    },
    {
      id: 't4', lat: -25.2940, lng: -57.6310, title: 'Limpieza profunda antes de mudarme',
      category: 'limpieza', description: 'Depto de 2 dormitorios en Sajonia. Necesito limpieza profunda: cocina, baños y vidrios.',
      barrio: 'Sajonia', budgetMin: 200000, budgetMax: 350000, urgent: false,
      photos: [], status: 'open', createdBy: 'other', createdAt: '2026-09-27',
      offers: [
        { id: 't4o1', handymanId: 'h4', handymanName: 'Rosa Medina', rating: 4.9, jobs: 89, amount: 280000, message: 'Voy con mi equipo de 2, llevamos todo.', status: 'pending' },
      ],
    },
    {
      id: 't5', lat: -25.2870, lng: -57.5700, title: 'Mudanza chica: de Villa Morra a Loma Pytá',
      category: 'mudanza', description: 'Heladera, lavarropas, cama de 2 plazas y unas 20 cajas. Tengo ayuda para cargar.',
      barrio: 'Villa Morra', budgetMin: 400000, budgetMax: 600000, urgent: false,
      photos: [], status: 'open', createdBy: 'other', createdAt: '2026-09-26',
      offers: [],
    },
    {
      id: 't6', lat: -25.2630, lng: -57.5950, title: 'Armar muebles de melamina (placard + escritorio)',
      category: 'otros', description: 'Compré un placard y un escritorio desarmados. Necesito alguien con herramientas que los arme.',
      barrio: 'Trinidad', budgetMin: 150000, budgetMax: 250000, urgent: false,
      photos: [], status: 'open', createdBy: 'other', createdAt: '2026-09-25',
      offers: [],
    },
  ],

  // Un trabajo en curso donde "vos" sos el handyman (para mostrar ese lado)
  myHandymanJob: {
    id: 'j1', taskId: 't0', title: 'Instalar 3 estanterías flotantes',
    category: 'otros', barrio: 'Recoleta',
    description: 'Tres estanterías flotantes en el living. Pared de ladrillo.',
    clientName: 'Silvia G.', clientId: 'c1',
    handymanId: 'me', handymanName: 'Vos',
    agreedPrice: 180000, paid: 180000,
    status: 'in_progress',
    photos: [],
    quotes: [],
    messages: [
      { from: 'them', text: 'Hola! Te paso fotos de la pared donde van las estanterías', time: '10:20' },
      { from: 'me', text: 'Dale, las veo y te mando la cotización cerrada', time: '10:35' },
    ],
  },

  // Un trabajo en curso donde "vos" sos el cliente (para coordinar y completar)
  myClientJob: {
    id: 'j2', taskId: 't0b', title: 'Reparar puerta del placard',
    category: 'otros', barrio: 'Villa Morra',
    description: 'La puerta del placard se salió de la guía.',
    clientName: 'Vos', clientId: 'me',
    handymanId: 'h5', handymanName: 'Carlos Ayala',
    agreedPrice: null, paid: 0,
    status: 'quoting',
    photos: [],
    quotes: [
      { id: 'j2q1', amount: 130000, detail: 'Reparación de guía + ajuste de puerta. Incluye materiales.', status: 'pending' },
    ],
    messages: [
      { from: 'me', text: 'Hola Carlos, te adjunto fotos de la puerta', time: '09:10' },
      { from: 'them', text: 'Vistas! Te mando mi cotización cerrada 👇', time: '09:40' },
    ],
  },

  chatThreads: [
    {
      id: 'c1', peerName: 'Camila Duarte', peerInitials: 'CD', peerColor: '#8B5CF6',
      proId: 'p1',
      messages: [
        { from: 'them', text: 'Hola! Gracias por tu reserva 😊', time: 'Ayer' },
        { from: 'me', text: 'Hola Camila! Una consulta: ¿trabajás con mi tipo de pelo?', time: 'Ayer' },
        { from: 'them', text: 'Sí! Traé una foto de referencia si querés y lo vemos juntas', time: 'Ayer' },
      ],
    },
    {
      id: 'c2', peerName: 'María José Aquino', peerInitials: 'MA', peerColor: '#10B981',
      proId: 'p5',
      messages: [
        { from: 'me', text: 'Hola! Para la limpieza profunda, ¿llevás tus productos?', time: 'Lun' },
        { from: 'them', text: 'Hola! Sí, llevo todo. Solo necesito que haya agua caliente 😄', time: 'Lun' },
      ],
    },
  ],

  businessSeed: {
    name: 'Pelo & Arte',
    category: 'Peluquería',
    barrio: 'Villa Morra',
    address: 'Av. Mariscal López 2024',
    phone: '0981 234 567',
    verified: false,
    services: [
      { id: 'b1', name: 'Corte mujer', cat: 'Cortes y peinados', price: 85000, durationMin: 45, active: true },
      { id: 'b2', name: 'Color + nutrición', cat: 'Color', price: 320000, durationMin: 150, active: true },
      { id: 'b3', name: 'Peinado fiesta', cat: 'Cortes y peinados', price: 120000, durationMin: 60, active: true },
    ],
    team: [
      { id: 'tm1', name: 'Dahiana Ruiz', role: 'Colorista', initials: 'DR', color: '#8B5CF6' },
      { id: 'tm2', name: 'Jorge Samudio', role: 'Barbero', initials: 'JS', color: '#3B82F6' },
    ],
    reviews: [
      { id: 'br1', author: 'Laura M.', rating: 5, date: '2026-09-24', text: 'Me encantó el color, superó mis expectativas.', reply: null },
      { id: 'br2', author: 'Nati P.', rating: 4, date: '2026-09-15', text: 'Buen servicio, aunque tuve que esperar 15 minutos.', reply: 'Gracias por tu visita, Nati! Estamos ajustando los tiempos entre turnos para que no vuelva a pasar. Te esperamos 💜' },
    ],
    documents: [
      { id: 'd1', name: 'RUC', status: 'pending' },
      { id: 'd2', name: 'Cédula del titular', status: 'pending' },
      { id: 'd3', name: 'Habilitación municipal', status: 'pending' },
    ],
  },

  notificationsSeed: [
    { id: 'n1', icon: '📅', title: 'Tu turno es mañana', text: 'Masaje descontracturante con Nadia López, mañana a las 10:00.', time: 'Hace 2 h', read: false, link: '#/reservas' },
    { id: 'n2', icon: '💰', title: 'Nueva oferta en tu tarea', text: 'Miguel Ángel Sosa ofertó Gs. 120.000 en "Se me rompió la canilla".', time: 'Ayer', read: false, link: '#/handyman/tarea/t1' },
  ],
};

/* Slot ocupados de ejemplo: proId -> 'YYYY-MM-DD' -> [horas ocupadas] */
const OPPI_BUSY_SLOTS = {
  p1: { offset: [1, 3] }, // se genera dinámicamente: mañana y pasado con horarios llenos
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OPPI_SEED, OPPI_BUSY_SLOTS, OppiConfig };
}
