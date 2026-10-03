import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing } from '../theme';

/**
 * Términos de uso de Oppi (ruta "Terms").
 * Mismo texto serio que la web, en español. Accesible desde el registro
 * (checkbox obligatorio) y desde Mi perfil.
 */
const SECTIONS = [
  {
    h: '1. Qué es Oppi',
    p: 'Oppi es una plataforma que conecta clientes con profesionales, handymen y negocios de servicios en Paraguay. Oppi no presta los servicios: cada reserva es un contrato directo entre el cliente y quien presta el servicio. Oppi facilita la búsqueda, la reserva, la comunicación y el pago del servicio.',
  },
  {
    h: '2. Tu cuenta',
    p: 'Para usar Oppi tenés que registrarte con datos reales y mantenerlos actualizados. Sos responsable de todo lo que se haga con tu cuenta. No podés prestar tu cuenta ni crear cuentas falsas. Si detectamos uso fraudulento, podemos suspender o eliminar tu cuenta.',
  },
  {
    h: '3. Reservas y pagos',
    p: 'Al confirmar una reserva aceptás el precio, el horario y la política de cancelación que se muestran antes de pagar. Pagás el total del servicio por adelantado: el monto exacto se muestra siempre antes del botón de pagar. El pago no es reembolsable si cancelás fuera del plazo gratuito o si no te presentás, según la política de comodines vigente.',
  },
  {
    h: '4. Cancelaciones y no-shows',
    p: 'Podés cancelar gratis hasta el plazo indicado en cada reserva. Pasado ese plazo, la cancelación consume un comodín o implica la pérdida del pago, según tu situación. Si no te presentás sin avisar (no-show), tu cuenta puede ser suspendida temporalmente. Los profesionales y negocios tienen las mismas obligaciones: si cancelan reiteradamente, también pueden ser suspendidos.',
  },
  {
    h: '5. Conducta',
    p: 'Está prohibido usar Oppi para fines ilegales, publicar contenido falso o engañoso, suplantar identidades, acosar a otros usuarios o intentar saltear la plataforma para evadir comisiones cuando corresponda. Las reseñas tienen que reflejar experiencias reales: las falsas o pagas se eliminan.',
  },
  {
    h: '6. Profesionales, handymen y negocios',
    p: 'Quienes ofrecen servicios declaran tener la habilitación, los permisos y la idoneidad necesarios para su rubro. Son responsables de la calidad, la puntualidad y la seguridad del servicio. Oppi puede pedir documentos de verificación y suspender perfiles que no los presenten o que acumulen reclamos fundados.',
  },
  {
    h: '7. Pagos',
    p: 'Los pagos se procesan a través de los medios habilitados en la app. Oppi cobra el total al confirmar la reserva y puede retenerlo hasta que el servicio se concrete, como garantía para ambas partes. Los precios se muestran en guaraníes e incluyen los impuestos que correspondan según la legislación paraguaya.',
  },
  {
    h: '8. Limitación de responsabilidad',
    p: 'Oppi hace su mejor esfuerzo para que la plataforma funcione bien, pero no garantiza disponibilidad ininterrumpida ni se hace responsable por daños derivados del servicio prestado por terceros, ni por acuerdos hechos fuera de la plataforma. Nuestra responsabilidad se limita, en todos los casos, al monto pagado en la reserva involucrada.',
  },
  {
    h: '9. Cambios y contacto',
    p: 'Podemos actualizar estos términos; los cambios importantes se avisan en la app. Si seguís usando Oppi después del aviso, aceptás los nuevos términos. Para consultas escribinos desde Ayuda y soporte dentro de la app.',
  },
];

export function TermsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Términos de uso" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.updated}>Última actualización: octubre 2026</Text>
        {SECTIONS.map((s) => (
          <View key={s.h} style={styles.section}>
            <Text style={styles.h}>{s.h}</Text>
            <Text style={styles.p}>{s.p}</Text>
          </View>
        ))}
        <TouchableOpacity
          style={styles.privacyLink}
          onPress={() => navigation.navigate('Privacy')}
          activeOpacity={0.85}
        >
          <Text style={styles.privacyLinkText}>Ver Política de privacidad →</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { padding: spacing.lg },
  updated: { fontSize: fontSize.sm, color: colors.muted, marginBottom: spacing.md },
  section: { marginBottom: spacing.md },
  h: { fontSize: fontSize.md, fontWeight: '800', color: colors.text, marginBottom: 6 },
  p: { fontSize: fontSize.sm, color: colors.text, lineHeight: 22 },
  privacyLink: { marginTop: spacing.md, paddingVertical: spacing.sm },
  privacyLinkText: { fontSize: fontSize.md, color: colors.primary, fontWeight: '700' },
});
