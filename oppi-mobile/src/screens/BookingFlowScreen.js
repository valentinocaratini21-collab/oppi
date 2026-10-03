import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
} from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../store/AuthContext';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { gs, shortDate } from '../utils';
import { colors, fontSize, spacing, radius } from '../theme';

const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const CANCEL_SHORT = 'Cancelación gratis hasta 3 h antes. Si no te presentás, el pago no se devuelve.';

function nextDays(n) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push({ iso, label: i === 0 ? 'Hoy' : shortDate(iso) });
  }
  return out;
}

/** Horas candidatas (cada hora) según el horario del negocio para ese día. */
function hoursForDate(iso, schedule) {
  const dt = new Date(`${iso}T12:00:00`);
  const entry = (schedule || []).find((s) => s.day === DAY_NAMES[dt.getDay()]);
  const toMin = (t) => {
    const [h, m] = String(t || '0').split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const open = toMin(entry?.open || '09:00');
  const close = toMin(entry?.close || '18:00');
  const out = [];
  for (let m = open; m + 60 <= close; m += 60) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  // Si es hoy, solo horas futuras.
  const todayIso = nextDays(1)[0].iso;
  if (iso === todayIso) {
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return out.filter((t) => toMin(t) > nowMin);
  }
  return out;
}

/**
 * Reserva en 3 pasos (profesional individual — flujo original intacto):
 *  1. Elegir servicio / fecha / hora (turnos libres del profesional).
 *  2. Confirmación con pago total (+ crédito aplicable).
 *  3. Éxito con el estado de la reserva.
 *
 * Modo negocio (params {businessId, serviceId?, staffId?, staffName?}):
 *  1. Servicio + profesional ("Sin preferencia" o miembro del equipo).
 *     Si el miembro tiene servicios asignados, se filtra la lista.
 *  2. Día y hora PREFERIDOS (el negocio confirma el horario exacto).
 *  3. Confirmación con desglose (servicio / cupón / crédito / total a pagar),
 *     política de cancelación y [Pagar Gs. X] (simulado).
 *
 * NOTA backend: bookings no tiene staff_id y los slots son solo de
 * profesionales individuales, así que la reserva del negocio se crea con
 * {service_id} y el staff + horario quedan como preferencia visible en
 * la confirmación (el negocio los confirma al aceptar).
 */
export function BookingFlowScreen({ navigation, route }) {
  const {
    proId,
    services: paramServices = [],
    proName,
    businessId,
    serviceId: preselectedServiceId,
    staffId: preselectedStaffId,
    staffName,
    // Fricción: desde el perfil del profesional se puede venir con el turno
    // ya elegido: { date: 'AAAA-MM-DD', time: 'HH:MM' }. Solo aplica al modo
    // profesional (los negocios no tienen slots individuales).
    preselectSlot = null,
  } = route.params;
  const isBusiness = !!businessId;
  const { user } = useAuth();
  const [step, setStep] = useState(1);

  // Servicios: del profesional (params) o del negocio (API).
  const [services, setServices] = useState(isBusiness ? [] : paramServices);
  const [serviceId, setServiceId] = useState(preselectedServiceId ?? paramServices[0]?.id ?? null);
  const [bizLoading, setBizLoading] = useState(isBusiness);

  // Negocio: equipo + datos.
  const [team, setTeam] = useState([]);
  const [business, setBusiness] = useState(null);
  const [staffId, setStaffId] = useState(preselectedStaffId ?? null);

  // Sucursales del negocio: si hay más de una, el cliente elige en cuál reservar.
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState(null);

  // Turnos del profesional (flujo original).
  const [slotsByDate, setSlotsByDate] = useState({});
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(!isBusiness);

  // Horario preferido (modo negocio).
  const [days] = useState(() => nextDays(14));
  const [prefDate, setPrefDate] = useState(() => nextDays(14)[0].iso);
  const [prefTime, setPrefTime] = useState(null);

  const [creditInput, setCreditInput] = useState('0');
  const [creating, setCreating] = useState(false);
  const [booking, setBooking] = useState(null);

  // Cupón (solo modo negocio): se valida ANTES de pagar.
  const [couponCode, setCouponCode] = useState('');
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState('');
  const [validatingCoupon, setValidatingCoupon] = useState(false);

  async function applyCoupon() {
    const clean = couponCode.trim().toUpperCase();
    if (!clean) return;
    setValidatingCoupon(true);
    setCouponMsg('');
    try {
      const res = await api.validateCoupon({
        code: clean,
        business_id: businessId,
        service_id: serviceId,
      });
      if (res.valid && Number(res.discount_gs) > 0) {
        setCouponDiscount(Number(res.discount_gs));
        setCouponMsg(`Cupón aplicado: se descuentan ${gs(res.discount_gs)} del total.`);
      } else {
        setCouponDiscount(0);
        setCouponMsg(res.message || 'Ese cupón no es válido para este servicio.');
      }
    } catch (e) {
      setCouponDiscount(0);
      setCouponMsg(e.message || 'No pudimos validar el cupón.');
    } finally {
      setValidatingCoupon(false);
    }
  }

  // Flujo original: turnos del profesional.
  useEffect(() => {
    if (isBusiness) return;
    (async () => {
      try {
        const { slots } = await api.slots({ professional_id: proId });
        const grouped = {};
        for (const s of slots) {
          if (s.status !== 'free') continue;
          if (!grouped[s.date]) grouped[s.date] = [];
          grouped[s.date].push(s);
        }
        const sorted = Object.keys(grouped).sort();
        setSlotsByDate(grouped);
        setDates(sorted);
        if (sorted.length) setSelectedDate(sorted[0]);
        // preselectSlot: si el turno elegido en el perfil sigue libre,
        // queda preseleccionado y se salta al paso de confirmación.
        if (preselectSlot?.date && preselectSlot?.time) {
          const wantTime = String(preselectSlot.time).slice(0, 5);
          const daySlots = (grouped[preselectSlot.date] || []).filter((s) => s.status === 'free');
          const match = daySlots.find((s) => String(s.time).slice(0, 5) === wantTime);
          if (match) {
            setSelectedDate(preselectSlot.date);
            setSelectedSlot(match);
            setStep(2);
          }
        }
      } catch (e) {
        Alert.alert('Error', e.message || 'No pudimos cargar los turnos.');
      } finally {
        setSlotsLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proId, isBusiness]);

  // Modo negocio: servicios + equipo + datos del negocio.
  useEffect(() => {
    if (!isBusiness) return;
    (async () => {
      try {
        const data = await api.business(businessId);
        setBusiness(data.business);
        setTeam(data.team || []);
        const list = data.services || [];
        setServices(list);
        if (!preselectedServiceId && list.length && !serviceId) {
          setServiceId(list[0].id);
        }
        // Sucursales: si hay más de una, se muestra el selector en el paso 1.
        try {
          const bdata = await api.businessBranches(businessId);
          const blist = bdata.branches || bdata || [];
          setBranches(blist);
          if (blist.length === 1) setBranchId(blist[0].id);
        } catch {
          setBranches([]);
        }
      } catch (e) {
        Alert.alert('Error', e.message || 'No pudimos cargar el negocio.');
      } finally {
        setBizLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, isBusiness]);

  // Si el staff elegido tiene servicios asignados, filtrar por ellos.
  const visibleServices = useMemo(() => {
    if (!isBusiness || !staffId) return services;
    const member = team.find((m) => String(m.id) === String(staffId));
    const allowed = member?.services || [];
    if (!allowed.length) return services;
    return services.filter((s) => allowed.some((a) => String(a) === String(s.id)));
  }, [isBusiness, staffId, team, services]);

  useEffect(() => {
    if (isBusiness && staffId && visibleServices.length && !visibleServices.some((s) => s.id === serviceId)) {
      setServiceId(visibleServices[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleServices]);

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const availableCredit = Number(user?.credit_gs || 0);
  const staffMember = useMemo(
    () => team.find((m) => String(m.id) === String(staffId)),
    [team, staffId]
  );

  const applyCredit = useMemo(() => {
    const n = parseInt(creditInput, 10);
    if (!Number.isInteger(n) || n <= 0) return 0;
    return Math.min(n, service?.price_gs || 0, availableCredit);
  }, [creditInput, service, availableCredit]);

  // Pago 100%: el cliente paga el total (menos crédito y cupón) al confirmar.
  const totalToPay = useMemo(
    () => Math.max(0, (service?.price_gs || 0) - applyCredit - couponDiscount),
    [service, applyCredit, couponDiscount]
  );

  const prefHours = useMemo(
    () => (isBusiness ? hoursForDate(prefDate, business?.schedule) : []),
    [isBusiness, prefDate, business]
  );

  async function confirmBooking() {
    setCreating(true);
    try {
      // En modo negocio no se manda slot_id (los slots son de profesionales
      // individuales): la reserva queda pendiente y el negocio la confirma.
      const { booking: b } = await api.createBooking({
        service_id: serviceId,
        slot_id: !isBusiness ? selectedSlot?.id || null : undefined,
        ...(isBusiness && branchId ? { branch_id: branchId } : {}),
        ...(applyCredit > 0 ? { apply_credit_gs: applyCredit } : {}),
        ...(couponDiscount > 0 ? { coupon_code: couponCode.trim().toUpperCase() } : {}),
      });
      setBooking(b);
      setStep(isBusiness ? 4 : 3);
    } catch (e) {
      Alert.alert('No pudimos crear la reserva', e.message || 'Intentá de nuevo.');
    } finally {
      setCreating(false);
    }
  }

  function addToCalendar() {
    Alert.alert(
      'Agregar a calendario (simulado)',
      `Anotá: ${service?.name} en ${business?.name} — ${shortDate(prefDate)} ${prefTime || ''} ` +
        `(horario preferido, el negocio lo confirma). Te avisamos cuando esté confirmada.`
    );
  }

  const daySlots = selectedDate ? slotsByDate[selectedDate] || [] : [];
  const stepLabels = isBusiness
    ? ['Servicio', 'Horario', 'Confirmar', 'Listo']
    : ['Servicio y turno', 'Confirmar', 'Listo'];
  const headerTitle = isBusiness
    ? `Reservar — ${business?.name || ''}`
    : `Reservar${proName ? ` — ${proName}` : ''}`;

  return (
    <View style={styles.wrap}>
      <ScreenHeader
        title={headerTitle}
        onBack={() => (step === 1 ? navigation.goBack() : setStep(step - 1))}
      />
      {/* Indicador de pasos */}
      <View style={styles.steps}>
        {stepLabels.map((label, i) => (
          <View key={label} style={styles.stepItem}>
            <View style={[styles.dot, step > i && styles.dotActive]}>
              <Text style={[styles.dotText, step > i && styles.dotTextActive]}>{i + 1}</Text>
            </View>
            <Text style={[styles.stepLabel, step > i && styles.stepLabelActive]}>{label}</Text>
          </View>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        {step === 1 && !isBusiness && (
          <>
            <Text style={styles.section}>1 · Elegí el servicio</Text>
            {paramServices.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={[styles.option, serviceId === s.id && styles.optionActive]}
                onPress={() => setServiceId(s.id)}
              >
                <Text style={styles.optionTitle}>{s.name}</Text>
                <Text style={styles.optionSub}>{gs(s.price_gs)}</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.section}>2 · Elegí el día</Text>
            {slotsLoading ? (
              <ActivityIndicator color={colors.primary} />
            ) : dates.length === 0 ? (
              <Card>
                <Text style={styles.empty}>Este profesional no tiene turnos libres por ahora.</Text>
              </Card>
            ) : (
              <View style={styles.chips}>
                {dates.map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.chip, selectedDate === d && styles.chipActive]}
                    onPress={() => {
                      setSelectedDate(d);
                      setSelectedSlot(null);
                    }}
                  >
                    <Text style={[styles.chipText, selectedDate === d && styles.chipTextActive]}>
                      {shortDate(d)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {selectedDate && daySlots.length > 0 && (
              <>
                <Text style={styles.section}>3 · Elegí la hora</Text>
                <View style={styles.chips}>
                  {daySlots.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, selectedSlot?.id === s.id && styles.chipActive]}
                      onPress={() => setSelectedSlot(s)}
                    >
                      <Text style={[styles.chipText, selectedSlot?.id === s.id && styles.chipTextActive]}>
                        {s.time.slice(0, 5)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <PrimaryButton
              title="Continuar"
              disabled={!service || !selectedSlot}
              onPress={() => setStep(2)}
              style={styles.cta}
            />
            {!selectedSlot && service ? (
              <Text style={styles.hint}>Elegí un turno para continuar.</Text>
            ) : null}
          </>
        )}

        {step === 1 && isBusiness && (
          <>
            {bizLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : (
              <>
                <Text style={styles.section}>1 · Elegí el servicio</Text>
                {visibleServices.length === 0 ? (
                  <Card><Text style={styles.empty}>Este negocio no tiene servicios por ahora.</Text></Card>
                ) : (
                  visibleServices.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.option, serviceId === s.id && styles.optionActive]}
                      onPress={() => setServiceId(s.id)}
                    >
                      <Text style={styles.optionTitle}>{s.name}</Text>
                      <Text style={styles.optionSub}>{gs(s.price_gs)}</Text>
                    </TouchableOpacity>
                  ))
                )}

                <Text style={styles.section}>2 · ¿Con quién?</Text>
                <View style={styles.chips}>
                  <TouchableOpacity
                    style={[styles.chip, !staffId && styles.chipActive]}
                    onPress={() => setStaffId(null)}
                  >
                    <Text style={[styles.chipText, !staffId && styles.chipTextActive]}>
                      Sin preferencia
                    </Text>
                  </TouchableOpacity>
                  {team.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.chip, String(staffId) === String(m.id) && styles.chipActive]}
                      onPress={() => setStaffId(m.id)}
                    >
                      <Text style={[styles.chipText, String(staffId) === String(m.id) && styles.chipTextActive]}>
                        {m.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {staffMember && (
                  <Text style={styles.staffNote}>
                    Reservar con {staffMember.name}
                    {staffMember.role ? ` · ${staffMember.role}` : ''}
                  </Text>
                )}

                {branches.length > 1 && (
                  <>
                    <Text style={styles.section}>3 · ¿En qué sucursal?</Text>
                    <View style={styles.chips}>
                      {branches.map((br) => (
                        <TouchableOpacity
                          key={br.id}
                          style={[styles.chip, String(branchId) === String(br.id) && styles.chipActive]}
                          onPress={() => setBranchId(br.id)}
                        >
                          <Text style={[styles.chipText, String(branchId) === String(br.id) && styles.chipTextActive]}>
                            🏪 {br.nombre}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {branchId && (
                      <Text style={styles.staffNote}>
                        📍 {branches.find((br) => String(br.id) === String(branchId))?.direccion || ''}
                      </Text>
                    )}
                  </>
                )}

                <PrimaryButton
                  title="Continuar"
                  disabled={!service}
                  onPress={() => setStep(2)}
                  style={styles.cta}
                />
              </>
            )}
          </>
        )}

        {step === 2 && isBusiness && (
          <>
            <Text style={styles.section}>Elegí el día</Text>
            <View style={styles.chips}>
              {days.map((d) => (
                <TouchableOpacity
                  key={d.iso}
                  style={[styles.chip, prefDate === d.iso && styles.chipActive]}
                  onPress={() => {
                    setPrefDate(d.iso);
                    setPrefTime(null);
                  }}
                >
                  <Text style={[styles.chipText, prefDate === d.iso && styles.chipTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.section}>Elegí la hora</Text>
            {prefHours.length === 0 ? (
              <Card><Text style={styles.empty}>Ese día no hay horarios disponibles.</Text></Card>
            ) : (
              <View style={styles.chips}>
                {prefHours.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.chip, prefTime === h && styles.chipActive]}
                    onPress={() => setPrefTime(h)}
                  >
                    <Text style={[styles.chipText, prefTime === h && styles.chipTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={styles.hint}>
              Horario preferido: el negocio confirma el horario exacto al aceptar tu reserva.
            </Text>

            <PrimaryButton
              title="Continuar"
              disabled={!prefTime}
              onPress={() => setStep(3)}
              style={styles.cta}
            />
          </>
        )}

        {step === 2 && !isBusiness && service && (
          <>
            <Text style={styles.section}>Confirmá tu reserva</Text>
            <Card>
              <Text style={styles.row}>
                <Text style={styles.key}>Servicio: </Text>
                {service.name}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Día: </Text>
                {selectedDate ? shortDate(selectedDate) : '—'}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Hora: </Text>
                {selectedSlot ? selectedSlot.time.slice(0, 5) : '—'}
              </Text>
              <Text style={styles.total}>Total: {gs(service.price_gs)}</Text>
            </Card>

            <Card style={styles.payCard}>
              <Text style={styles.payTitle}>Total a pagar: {gs(totalToPay)}</Text>
              <Text style={styles.paySub}>
                Pago simulado: hoy no se cobra nada de verdad. La pasarela real se conecta antes del lanzamiento.
              </Text>
            </Card>

            {availableCredit > 0 && (
              <Card>
                <Text style={styles.key}>Tenés {gs(availableCredit)} de crédito</Text>
                <Text style={styles.sub2}>¿Cuánto querés aplicar a esta reserva?</Text>
                <TextInput
                  style={styles.input}
                  value={creditInput}
                  onChangeText={(t) => setCreditInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
                {applyCredit > 0 && (
                  <Text style={styles.applied}>Se aplican {gs(applyCredit)}. Total a pagar: {gs(totalToPay)}</Text>
                )}
              </Card>
            )}

            <PrimaryButton title={`Pagar ${gs(totalToPay)}`} onPress={confirmBooking} loading={creating} style={styles.cta} />
            <Text style={styles.hint}>
              Pago simulado: hoy no se cobra nada de verdad. La pasarela real se conecta antes del lanzamiento.
            </Text>
            <PrimaryButton title="Volver" variant="ghost" onPress={() => setStep(1)} />
          </>
        )}

        {step === 3 && isBusiness && service && (
          <>
            <Text style={styles.section}>Confirmá tu reserva</Text>
            <Card>
              <Text style={styles.row}>
                <Text style={styles.key}>Servicio: </Text>
                {service.name}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Negocio: </Text>
                {business?.name}
              </Text>
              {staffMember && (
                <Text style={styles.row}>
                  <Text style={styles.key}>Profesional: </Text>
                  {staffMember.name} (preferencia)
                </Text>
              )}
              {branchId && (
                <Text style={styles.row}>
                  <Text style={styles.key}>Sucursal: </Text>
                  {branches.find((br) => String(br.id) === String(branchId))?.nombre || ''}
                </Text>
              )}
              <Text style={styles.row}>
                <Text style={styles.key}>Horario preferido: </Text>
                {shortDate(prefDate)} {prefTime}
              </Text>
            </Card>

            <Card style={styles.breakdown}>
              <Text style={styles.bRow}>Servicio: {gs(service.price_gs)}</Text>
              {couponDiscount > 0 && <Text style={styles.couponRow}>Cupón {couponCode.trim().toUpperCase()}: −{gs(couponDiscount)}</Text>}
              {applyCredit > 0 && <Text style={styles.bRow}>Crédito aplicado: −{gs(applyCredit)}</Text>}
              <Text style={styles.bRowBold}>Total a pagar: {gs(totalToPay)}</Text>
            </Card>

            <Card>
              <Text style={styles.key}>¿Tenés un cupón?</Text>
              <Text style={styles.sub2}>Ingresalo antes de pagar y se descuenta del total.</Text>
              <View style={styles.couponRowWrap}>
                <TextInput
                  style={[styles.input, styles.couponInput]}
                  value={couponCode}
                  onChangeText={(t) => {
                    setCouponCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                    setCouponDiscount(0);
                    setCouponMsg('');
                  }}
                  placeholder="Ej. BIENVENIDO10"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="characters"
                  maxLength={20}
                />
                <PrimaryButton
                  title="Aplicar"
                  variant="secondary"
                  onPress={applyCoupon}
                  loading={validatingCoupon}
                  disabled={!couponCode.trim()}
                  style={styles.couponBtn}
                />
              </View>
              {!!couponMsg && (
                <Text style={couponDiscount > 0 ? styles.couponOk : styles.couponErr}>{couponMsg}</Text>
              )}
            </Card>

            {availableCredit > 0 && (
              <Card>
                <Text style={styles.key}>Tenés {gs(availableCredit)} de crédito</Text>
                <Text style={styles.sub2}>¿Cuánto querés aplicar a esta reserva?</Text>
                <TextInput
                  style={styles.input}
                  value={creditInput}
                  onChangeText={(t) => setCreditInput(t.replace(/[^0-9]/g, ''))}
                  keyboardType="numeric"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
              </Card>
            )}

            <Card>
              <Text style={styles.policy}>{CANCEL_SHORT}</Text>
              <TouchableOpacity
                onPress={() => navigation.navigate('BusinessProfile', { businessId, initialTab: 'info' })}
              >
                <Text style={styles.policyLink}>Ver política completa →</Text>
              </TouchableOpacity>
            </Card>

            <PrimaryButton
              title={`Pagar ${gs(totalToPay)}`}
              onPress={confirmBooking}
              loading={creating}
              style={styles.cta}
            />
            <Text style={styles.hint}>
              Pago simulado: hoy no se cobra nada de verdad. La pasarela real se conecta antes del lanzamiento.
            </Text>
            <PrimaryButton title="Volver" variant="ghost" onPress={() => setStep(2)} />
          </>
        )}

        {step === 3 && !isBusiness && booking && (
          <View style={styles.success}>
            <Text style={styles.successEmoji}>🎉</Text>
            <Text style={styles.successTitle}>¡Reserva creada!</Text>
            <Card>
              <Text style={styles.row}>
                <Text style={styles.key}>Servicio: </Text>
                {booking.service_name}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Estado: </Text>
                Pendiente de confirmación
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Total pagado: </Text>
                {gs(booking.total_gs)}
              </Text>
            </Card>
            <Text style={styles.paySub}>
              El profesional confirma tu reserva. Te avisamos cuando esté lista.
            </Text>
            <PrimaryButton
              title="Ver mis reservas"
              onPress={() => navigation.navigate('MainTabs', { screen: 'Reservas' })}
              style={styles.cta}
            />
            <PrimaryButton title="Volver al inicio" variant="ghost" onPress={() => navigation.navigate('MainTabs', { screen: 'Inicio' })} />
          </View>
        )}

        {step === 4 && isBusiness && booking && (
          <View style={styles.success}>
            <Text style={styles.successEmoji}>🎉</Text>
            <Text style={styles.successTitle}>¡Reserva creada!</Text>
            <Card>
              <Text style={styles.row}>
                <Text style={styles.key}>Servicio: </Text>
                {booking.service_name}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Negocio: </Text>
                {booking.business_name}
              </Text>
              {staffMember && (
                <Text style={styles.row}>
                  <Text style={styles.key}>Preferencia: </Text>
                  {staffMember.name}
                </Text>
              )}
              <Text style={styles.row}>
                <Text style={styles.key}>Horario preferido: </Text>
                {shortDate(prefDate)} {prefTime}
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Estado: </Text>
                Pendiente de confirmación
              </Text>
              <Text style={styles.row}>
                <Text style={styles.key}>Total pagado: </Text>
                {gs(booking.total_gs)}
              </Text>
            </Card>
            <Text style={styles.paySub}>
              El negocio confirma tu reserva y el horario exacto. Te avisamos cuando esté lista.
            </Text>
            <PrimaryButton
              title="📅 Agregar a calendario"
              variant="secondary"
              onPress={addToCalendar}
              style={styles.cta}
            />
            <PrimaryButton
              title="Ver mis reservas"
              onPress={() => navigation.navigate('MainTabs', { screen: 'Reservas' })}
              style={styles.cta}
            />
            <PrimaryButton title="Volver al inicio" variant="ghost" onPress={() => navigation.navigate('MainTabs', { screen: 'Inicio' })} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  steps: { flexDirection: 'row', justifyContent: 'center', paddingVertical: spacing.sm, backgroundColor: colors.bg, gap: spacing.md },
  stepItem: { alignItems: 'center', gap: 4 },
  dot: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  dotActive: { backgroundColor: colors.primary },
  dotText: { color: colors.muted, fontWeight: '800', fontSize: fontSize.sm },
  dotTextActive: { color: '#fff' },
  stepLabel: { fontSize: fontSize.xs, color: colors.muted },
  stepLabelActive: { color: colors.primary, fontWeight: '700' },
  inner: { padding: spacing.md, paddingBottom: spacing.lg },
  section: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  option: {
    backgroundColor: colors.card, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 14, marginBottom: 8,
  },
  optionActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.light },
  optionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  optionSub: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.card, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.border, paddingVertical: 10, paddingHorizontal: 16,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.md, fontWeight: '600', color: colors.text },
  chipTextActive: { color: '#fff' },
  staffNote: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: spacing.sm },
  cta: { marginTop: spacing.lg, marginBottom: spacing.sm, minHeight: 52, borderRadius: 16 },
  hint: { textAlign: 'center', color: colors.muted, fontSize: fontSize.sm, marginTop: spacing.sm, lineHeight: 20 },
  row: { fontSize: fontSize.md, color: colors.text, marginBottom: 6 },
  key: { fontWeight: '700' },
  total: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginTop: 8 },
  payCard: { borderLeftWidth: 4, borderLeftColor: colors.warning },
  payTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text },
  paySub: { fontSize: fontSize.sm, color: colors.muted, marginTop: 6, lineHeight: 20 },
  breakdown: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  bRow: { fontSize: fontSize.md, color: colors.text, marginBottom: 6 },
  bRowBold: { fontSize: fontSize.lg, fontWeight: '800', color: colors.text, marginBottom: 6 },
  policy: { fontSize: fontSize.sm, color: colors.muted, lineHeight: 20 },
  policyLink: { fontSize: fontSize.sm, color: colors.primary, fontWeight: '700', marginTop: 8 },
  input: {
    backgroundColor: colors.bg, borderRadius: radius.button, borderWidth: 1,
    borderColor: colors.border, padding: 12, fontSize: fontSize.md, color: colors.text, marginTop: 8,
  },
  sub2: { fontSize: fontSize.sm, color: colors.muted, marginTop: 4 },
  applied: { fontSize: fontSize.sm, color: colors.success, fontWeight: '700', marginTop: 8 },
  couponRowWrap: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  couponInput: { flex: 1, marginTop: 0 },
  couponBtn: { minHeight: 48, paddingVertical: 12 },
  couponOk: { fontSize: fontSize.sm, color: colors.success, fontWeight: '700', marginTop: 8 },
  couponErr: { fontSize: fontSize.sm, color: colors.danger, fontWeight: '600', marginTop: 8 },
  couponRow: { fontSize: fontSize.md, color: colors.primary, fontWeight: '800', marginBottom: 6 },
  success: { alignItems: 'center' },
  successEmoji: { fontSize: 56, marginTop: spacing.lg },
  successTitle: { fontSize: fontSize.xl, fontWeight: '900', color: colors.text, marginVertical: spacing.md },
  empty: { color: colors.muted, fontSize: fontSize.sm, textAlign: 'center' },
});
