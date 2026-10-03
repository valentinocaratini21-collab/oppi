import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { ScreenHeader } from '../components/ScreenHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { Rating } from '../components/Rating';
import { pickAndUpload } from '../utils/photos';
import { gs } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

/**
 * Mi perfil (una pantalla, menú estricto por rol).
 *  1) Header: foto circular, nombre, barrio, "Miembro desde 2026",
 *     ★ como cliente (promedio · N servicios) si tiene reseñas recibidas.
 *  2) Si tiene crédito: tarjeta violeta suave "Crédito disponible: Gs. X" → Referrals.
 *  3) Botón "Editar perfil" outline full width → modal con nombre, teléfono,
 *     barrio y foto; guarda contra PATCH /api/me (vía AuthContext.updateProfile)
 *     y actualiza la sesión guardada en AsyncStorage.
 *  4) Menú según user.role (cliente | pro | business | handyman): cada rol
 *     ve solo su mundo. Sin selector "Ver como" (no hay roles múltiples).
 *  5) "Cerrar sesión" en rojo suave con confirmación.
 *
 * El usuario tiene UN solo rol (user.role); no existe selector "Ver como"
 * porque no hay roles múltiples.
 * El backend responde con `nombre` (contrato PATCH /api/me); por compatibilidad
 * se lee también `name` en objetos viejos.
 */
const FAQ = [
  {
    q: '¿Cómo reservo un turno?',
    a: 'Buscá un profesional, elegí el servicio y el horario que te venga bien, y confirmá. Pagás el total al confirmar: el monto se muestra siempre antes del botón de pagar.',
  },
  {
    q: '¿Cómo pago?',
    a: 'Pagás el 100% del servicio al confirmar la reserva. Por ahora el pago es simulado: cuando la pasarela esté conectada vas a poder pagar con tarjeta desde la app.',
  },
  {
    q: '¿Cómo cancelo una reserva?',
    a: 'Desde "Mis reservas" → tocá la reserva → Cancelar. Si ya pagaste y cancelás tarde, podés perder el pago: te lo avisamos antes de confirmar.',
  },
  {
    q: '¿Cómo invito amigos y gano crédito?',
    a: 'Desde "Invitá y ganá" compartí tu código. Cuando un amigo se registre, ganás Gs. 20.000 de crédito para tus reservas.',
  },
  {
    q: '¿Qué es la lista de espera?',
    a: 'Si el turno que querés está lleno, anotate y te avisamos en cuanto se libere.',
  },
];

export function ProfileScreen({ navigation }) {
  const { user, logout, refreshUser, updateProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const userName = user?.nombre ?? user?.name ?? '';
  const [profileName, setProfileName] = useState(userName);
  const [profileBarrio, setProfileBarrio] = useState(user?.barrio || '');
  const [profileFoto, setProfileFoto] = useState(user?.foto_url || user?.foto || '');
  const [clientRating, setClientRating] = useState(null);
  const [clientReviews, setClientReviews] = useState(0);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [waitlistCount, setWaitlistCount] = useState(0);
  const [waitlist, setWaitlist] = useState([]);
  const [leavingId, setLeavingId] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editTelefono, setEditTelefono] = useState('');
  const [editBarrio, setEditBarrio] = useState('');
  const [editFoto, setEditFoto] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [mockCards, setMockCards] = useState([
    { id: 'visa', label: 'Visa', last4: '4242' },
  ]);

  const load = useCallback(async () => {
    try {
      const u = await refreshUser();
      setProfileName(u?.nombre ?? u?.name ?? '');
      setProfileBarrio(u?.barrio || '');
      setProfileFoto(u?.foto_url || u?.foto || '');
      const [rev, books, wl] = await Promise.all([
        api.reviews({ to_user: u?.id }).catch(() => ({ reviews: [] })),
        api.bookings().catch(() => ({ bookings: [] })),
        api.waitlist().catch(() => ({ waitlist: [] })),
      ]);
      const list = rev.reviews || [];
      if (list.length) {
        setClientReviews(list.length);
        setClientRating(list.reduce((a, r) => a + Number(r.rating || 0), 0) / list.length);
      }
      setUpcomingCount(
        (books.bookings || []).filter((b) => ['pending', 'confirmed'].includes(b.status)).length
      );
      setWaitlist(wl.waitlist || []);
      setWaitlistCount((wl.waitlist || []).length);
    } catch {
      // queda el usuario cacheado
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [refreshUser]);

  useEffect(() => {
    load();
    checkAgent();
  }, [load, checkAgent]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      load();
      checkAgent();
    });
    return unsub;
  }, [navigation, load, checkAgent]);

  function onLogout() {
    Alert.alert('Cerrar sesión', '¿Querés salir de tu cuenta?', [
      { text: 'No', style: 'cancel' },
      { text: 'Sí, salir', style: 'destructive', onPress: () => logout() },
    ]);
  }

  function openEdit() {
    setEditName(profileName);
    setEditTelefono(user?.telefono || user?.phone || '');
    setEditBarrio(profileBarrio);
    setEditFoto(profileFoto);
    setEditOpen(true);
  }

  async function pickPhoto() {
    setPhotoBusy(true);
    try {
      const res = await pickAndUpload({ allowsEditing: true, quality: 0.7 });
      if (!res.canceled) setEditFoto(res.file.url);
    } catch (e) {
      Alert.alert('No pudimos subir la foto', e.message || 'Intentá de nuevo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  async function saveEdit() {
    const nombre = editName.trim();
    if (!nombre) {
      Alert.alert('Falta el nombre', 'Contanos cómo te llamás.');
      return;
    }
    setSaving(true);
    try {
      const u = await updateProfile({
        nombre,
        telefono: editTelefono.trim(),
        barrio: editBarrio.trim(),
        foto_url: editFoto,
      });
      setProfileName(u?.nombre ?? u?.name ?? nombre);
      setProfileBarrio(u?.barrio || '');
      setProfileFoto(u?.foto_url || u?.foto || '');
      setEditOpen(false);
    } catch (e) {
      Alert.alert(
        'No pudimos guardar tu perfil',
        e.message || 'Revisá tu conexión e intentá de nuevo.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function leaveWaitlist(id) {
    setLeavingId(id);
    try {
      await api.leaveWaitlist(id);
      const next = waitlist.filter((w) => w.id !== id);
      setWaitlist(next);
      setWaitlistCount(next.length);
    } catch (e) {
      Alert.alert('Error', e.message || 'No pudimos sacarte de la lista.');
    } finally {
      setLeavingId(null);
    }
  }

  function addMockCard() {
    const n = mockCards.length + 1;
    setMockCards((prev) => [
      ...prev,
      { id: `mock-${Date.now()}`, label: 'Tarjeta demo', last4: `${1000 + n}`.slice(-4) },
    ]);
  }

  const memberSince = user?.created_at ? String(user.created_at).slice(0, 4) : '2026';
  const credit = Number(user?.credit_gs || 0);

  // Soporte: solo visible para agentes (el backend responde 403 si no lo sos).
  const [isAgent, setIsAgent] = useState(false);
  const checkAgent = useCallback(async () => {
    try {
      await api.supportConversations({});
      setIsAgent(true);
    } catch {
      setIsAgent(false);
    }
  }, []);

  // Administración: solo visible para admins (la ruta también se registra solo
  // en ese caso en el navigator).
  const isAdmin = user?.is_admin === true || user?.is_admin === 1 || user?.role === 'admin';

  const role = user?.role;

  // Ítems comunes a todos los roles.
  const commonMenu = [
    {
      id: 'help-chat',
      icon: '💬',
      title: 'Ayuda y soporte',
      sub: 'Hablanos por el chat, te respondemos enseguida',
      onPress: () => navigation.navigate('HelpChat'),
    },
    {
      id: 'faq',
      icon: '❓',
      title: 'Preguntas frecuentes',
      sub: 'Respuestas rápidas',
      onPress: () => setFaqOpen(true),
    },
    {
      id: 'terms',
      icon: '📄',
      title: 'Términos y privacidad',
      sub: 'Condiciones de uso y tus datos',
      onPress: () => navigation.navigate('Terms'),
    },
    // Administración: solo visible para admins.
    ...(isAdmin
      ? [
          {
            id: 'admin',
            icon: '🛡️',
            title: 'Administración',
            sub: 'Verificaciones y usuarios',
            onPress: () => navigation.navigate('Admin'),
          },
        ]
      : []),
    // Bandeja de soporte: solo visible para agentes (el backend responde 403 si no lo sos).
    ...(isAgent
      ? [
          {
            id: 'support',
            icon: '🎧',
            title: 'Soporte',
            sub: 'Bandeja de WhatsApp de agentes',
            onPress: () => navigation.navigate('Support'),
          },
        ]
      : []),
  ];

  const sharedAccount = [
    {
      id: 'referrals',
      icon: '🎁',
      title: 'Invitá y ganá',
      sub: 'Ganá Gs. 20.000 por amigo',
      onPress: () => navigation.navigate('Referrals'),
    },
    {
      id: 'notifications',
      icon: '📨',
      title: 'Centro de avisos',
      sub: 'Tus avisos recientes',
      onPress: () => navigation.navigate('Notifications'),
    },
    {
      id: 'notification-prefs',
      icon: '🔔',
      title: 'Notificaciones',
      sub: 'Recordatorios, ofertas, mensajes y promos',
      onPress: () => navigation.navigate('NotificationPrefs'),
    },
    {
      id: 'my-payments',
      icon: '🧾',
      title: 'Mis pagos',
      sub: 'Pagos y comprobantes',
      onPress: () => navigation.navigate('Payments'),
    },
    {
      id: 'compliance',
      icon: '✅',
      title: 'Mi cumplimiento',
      sub: 'Tu % de turnos cumplidos y comodines',
      onPress: () => navigation.navigate('Compliance'),
    },
  ];

  // Menú estricto por rol: cada rol ve solo su mundo.
  const menuByRole = {
    client: [
      {
        id: 'bookings',
        icon: '📅',
        title: 'Mis reservas',
        sub: `${upcomingCount} próxima${upcomingCount === 1 ? '' : 's'}`,
        onPress: () => navigation.navigate('Reservas'),
      },
      {
        id: 'summary',
        icon: '📊',
        title: 'Mi resumen',
        sub: 'Tus números en Oppi',
        onPress: () => navigation.navigate('ClientSummary'),
      },
      {
        id: 'favorites',
        icon: '❤️',
        title: 'Favoritos',
        sub: 'Tus profesionales guardados',
        onPress: () => navigation.navigate('Favorites'),
      },
      {
        id: 'waitlist',
        icon: '⏳',
        title: 'Lista de espera',
        sub: waitlistCount > 0 ? `${waitlistCount} turno${waitlistCount === 1 ? '' : 's'} en espera` : 'Te avisamos si se libera un turno',
        badge: waitlistCount,
        onPress: () => setWaitlistOpen(true),
      },
      {
        id: 'payments',
        icon: '💳',
        title: 'Métodos de pago',
        sub: 'Tus tarjetas (demo)',
        onPress: () => setPayOpen(true),
      },
      ...sharedAccount,
    ],
    pro: [
      {
        id: 'agenda',
        icon: '📅',
        title: 'Mi agenda',
        sub: 'Tus turnos',
        onPress: () => navigation.navigate('Agenda'),
      },
      {
        id: 'services',
        icon: '💈',
        title: 'Mis servicios',
        sub: 'Precios y disponibilidad',
        onPress: () => navigation.navigate('Servicios'),
      },
      {
        id: 'clients',
        icon: '👥',
        title: 'Mis clientes',
        sub: 'Tu cartera',
        onPress: () => navigation.navigate('Clientes'),
      },
      {
        id: 'earnings',
        icon: '💰',
        title: 'Ganancias',
        sub: 'Cuánto venís ganando',
        onPress: () => navigation.navigate('Ganancias'),
      },
      {
        id: 'stats',
        icon: '📊',
        title: 'Estadísticas',
        sub: 'Conversión, respuesta y recurrentes',
        onPress: () => navigation.navigate('ProStats'),
      },
      ...sharedAccount,
    ],
    business: [
      {
        id: 'panel',
        icon: '🏪',
        title: 'Mi panel',
        sub: 'Gestión del negocio',
        onPress: () => navigation.navigate('Panel'),
      },
      {
        id: 'bookings',
        icon: '📝',
        title: 'Reservas',
        sub: 'Las reservas de tu negocio',
        onPress: () => navigation.navigate('Reservas'),
      },
      {
        id: 'reports',
        icon: '📊',
        title: 'Reportes',
        sub: 'Ingresos, top servicios y equipo',
        onPress: () => navigation.navigate('BusinessStats'),
      },
      ...sharedAccount,
    ],
    handyman: [
      {
        id: 'jobs',
        icon: '🛠️',
        title: 'Mis trabajos',
        sub: 'Tus chambas activas y completadas',
        onPress: () => navigation.navigate('Trabajos'),
      },
      {
        id: 'explore',
        icon: '🔍',
        title: 'Explorar chambas',
        sub: 'Tareas abiertas cerca tuyo',
        onPress: () => navigation.navigate('Explorar'),
      },
      {
        id: 'publish',
        icon: '➕',
        title: 'Publicar chamba',
        sub: 'Ofrecé tu trabajo',
        onPress: () => navigation.navigate('PublishTask'),
      },
      ...sharedAccount,
    ],
  };

  const menu = [...(menuByRole[role] || menuByRole.client), ...commonMenu];

  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Perfil" />
      <ScrollView
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
        }
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : (
          <>
            {/* 1) Header */}
            <Card>
              <View style={styles.head}>
                <View style={styles.avatar}>
                  {profileFoto ? (
                    <Image source={{ uri: profileFoto }} style={styles.avatarImg} />
                  ) : (
                    <Text style={styles.avatarText}>{(profileName || '?').charAt(0).toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{profileName}</Text>
                  {profileBarrio ? <Text style={styles.barrio}>{profileBarrio}</Text> : null}
                  <Text style={styles.member}>Miembro desde {memberSince}</Text>
                  {clientReviews > 0 && (
                    <View style={styles.ratingRow}>
                      <Rating value={clientRating} />
                      <Text style={styles.ratingSub}>
                        {' '}· {clientReviews} servicio{clientReviews === 1 ? '' : 's'} como cliente
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </Card>

            {/* 2) Crédito */}
            {credit > 0 && (
              <TouchableOpacity onPress={() => navigation.navigate('Referrals')} activeOpacity={0.85}>
                <Card style={styles.creditCard}>
                  <Text style={styles.creditLabel}>Crédito disponible</Text>
                  <Text style={styles.creditValue}>{gs(credit)}</Text>
                  <Text style={styles.creditLink}>Invitá amigos y ganá más →</Text>
                </Card>
              </TouchableOpacity>
            )}

            {/* 3) Editar perfil */}
            <PrimaryButton
              title="Editar perfil"
              variant="ghost"
              onPress={openEdit}
              style={styles.editBtn}
            />

            {/* 5) Menú */}
            {menu.map((it) => (
              <TouchableOpacity key={it.id} onPress={it.onPress} activeOpacity={0.85}>
                <Card>
                  <View style={styles.row}>
                    <Text style={styles.icon}>{it.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemTitle}>{it.title}</Text>
                      <Text style={styles.itemSub}>{it.sub}</Text>
                    </View>
                    {it.badge > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{it.badge}</Text>
                      </View>
                    )}
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </Card>
              </TouchableOpacity>
            ))}

            {/* 6) Cerrar sesión */}
            <TouchableOpacity onPress={onLogout} activeOpacity={0.85}>
              <Card style={styles.logoutCard}>
                <Text style={styles.logout}>Cerrar sesión</Text>
              </Card>
            </TouchableOpacity>

            {/* 7) Zona de peligro: eliminar cuenta */}
            <TouchableOpacity
              onPress={() => navigation.navigate('DeleteAccount')}
              activeOpacity={0.85}
            >
              <Card style={styles.deleteCard}>
                <Text style={styles.delete}>Eliminar mi cuenta</Text>
              </Card>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Modal: editar perfil */}
      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Editar perfil</Text>
              <TouchableOpacity onPress={() => setEditOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.fieldLabel}>Nombre</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Tu nombre"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.fieldLabel}>Teléfono</Text>
            <TextInput
              style={styles.input}
              value={editTelefono}
              onChangeText={setEditTelefono}
              placeholder="Ej. 0981 123 456"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
            />
            <Text style={styles.fieldLabel}>Barrio</Text>
            <TextInput
              style={styles.input}
              value={editBarrio}
              onChangeText={setEditBarrio}
              placeholder="¿En qué barrio estás?"
              placeholderTextColor={colors.muted}
            />
            <Text style={styles.fieldLabel}>Foto</Text>
            <TouchableOpacity style={styles.photoPick} onPress={pickPhoto} disabled={photoBusy}>
              {editFoto ? (
                <Image source={{ uri: editFoto }} style={styles.photoPickImg} />
              ) : (
                <Text style={styles.photoPickText}>{photoBusy ? 'Subiendo…' : '＋ Elegir foto'}</Text>
              )}
            </TouchableOpacity>
            <PrimaryButton
              title="Guardar"
              onPress={saveEdit}
              loading={saving}
              disabled={saving}
              style={styles.modalCta}
            />
          </View>
        </View>
      </Modal>

      {/* Modal: lista de espera */}
      <Modal visible={waitlistOpen} animationType="slide" transparent onRequestClose={() => setWaitlistOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Lista de espera</Text>
              <TouchableOpacity onPress={() => setWaitlistOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {waitlist.length === 0 ? (
              <Text style={styles.empty}>
                No estás en ninguna lista de espera. Cuando un turno esté lleno, anotate y te avisamos si se libera.
              </Text>
            ) : (
              waitlist.map((w) => (
                <View key={w.id} style={styles.wlRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wlTitle}>
                      {w.professional_name || 'Profesional'}
                      {w.service_name ? ` · ${w.service_name}` : ''}
                    </Text>
                    <Text style={styles.wlSub}>{w.slot_desc}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => leaveWaitlist(w.id)}
                    disabled={leavingId === w.id}
                    style={styles.wlLeave}
                  >
                    <Text style={styles.wlLeaveText}>{leavingId === w.id ? '…' : 'Salir'}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>
      </Modal>

      {/* Modal: métodos de pago (mock) */}
      <Modal visible={payOpen} animationType="slide" transparent onRequestClose={() => setPayOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Métodos de pago</Text>
              <TouchableOpacity onPress={() => setPayOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.demoNote}>Demo: las tarjetas son simuladas.</Text>
            {mockCards.map((c) => (
              <View key={c.id} style={styles.wlRow}>
                <Text style={styles.payIcon}>💳</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.wlTitle}>{c.label}</Text>
                  <Text style={styles.wlSub}>···· {c.last4}</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity onPress={addMockCard} style={styles.addCard}>
              <Text style={styles.addCardText}>＋ Agregar tarjeta (simulado)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: ayuda */}
      <Modal visible={faqOpen} animationType="slide" transparent onRequestClose={() => setFaqOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>Ayuda</Text>
              <TouchableOpacity onPress={() => setFaqOpen(false)} hitSlop={10}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            {FAQ.map((f) => (
              <View key={f.q} style={styles.faqItem}>
                <Text style={styles.faqQ}>{f.q}</Text>
                <Text style={styles.faqA}>{f.a}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.md },

  head: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.light,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
    overflow: 'hidden',
  },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarText: { fontSize: 30, fontWeight: '800', color: colors.primary },
  name: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  barrio: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  member: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  ratingSub: { fontSize: fontSize.sm, color: colors.muted },

  creditCard: { backgroundColor: colors.light, borderWidth: 1, borderColor: colors.primary },
  creditLabel: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700' },
  creditValue: { fontSize: fontSize.xl, fontWeight: '900', color: colors.primary, marginTop: 4 },
  creditLink: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: 8 },

  editBtn: { height: 52, borderRadius: 16, marginTop: spacing.sm },

  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { fontSize: 24, marginRight: spacing.sm },
  itemTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  itemSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  badge: {
    backgroundColor: colors.primary, borderRadius: 999, minWidth: 24, height: 24,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, marginRight: 8,
  },
  badgeText: { color: '#fff', fontSize: fontSize.xs, fontWeight: '800' },
  chevron: { fontSize: 24, color: colors.muted },

  logoutCard: { backgroundColor: '#FDECEC', borderWidth: 1, borderColor: '#F5C6C6' },
  logout: { textAlign: 'center', color: colors.danger, fontWeight: '700', fontSize: fontSize.md },

  deleteCard: { backgroundColor: '#FFF1F1', borderWidth: 1, borderColor: '#F5C6C6', borderStyle: 'dashed' },
  delete: { textAlign: 'center', color: colors.danger, fontWeight: '700', fontSize: fontSize.sm },

  modalBg: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.lg, maxHeight: '85%',
  },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  modalClose: { fontSize: 20, color: colors.muted, padding: 4 },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.muted, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, fontSize: fontSize.md, color: colors.text,
  },
  photoPick: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  photoPickImg: { width: 96, height: 96 },
  photoPickText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.sm },
  modalCta: { height: 52, borderRadius: 16, marginTop: spacing.lg },
  empty: { fontSize: fontSize.sm, color: colors.muted, textAlign: 'center', lineHeight: 20 },

  wlRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  wlTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  wlSub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 2 },
  wlLeave: {
    borderWidth: 1, borderColor: colors.danger, borderRadius: radius.button,
    paddingVertical: 8, paddingHorizontal: 14, marginLeft: spacing.sm,
  },
  wlLeaveText: { color: colors.danger, fontWeight: '700', fontSize: fontSize.sm },

  demoNote: { fontSize: fontSize.xs, color: colors.muted, marginBottom: spacing.sm },
  payIcon: { fontSize: 24, marginRight: spacing.sm },
  addCard: {
    marginTop: spacing.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.primary,
    borderRadius: radius.button, padding: 14, alignItems: 'center',
  },
  addCardText: { color: colors.primary, fontWeight: '700', fontSize: fontSize.md },

  faqItem: { marginBottom: spacing.md },
  faqQ: { fontSize: fontSize.md, fontWeight: '800', color: colors.text },
  faqA: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4, lineHeight: 20 },
});
