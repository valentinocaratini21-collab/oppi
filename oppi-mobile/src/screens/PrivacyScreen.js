import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ScreenHeader';
import { colors, fontSize, spacing } from '../theme';

/**
 * Política de privacidad de Oppi (ruta "Privacy").
 * Mismo texto serio que la web, en español. Accesible desde el registro
 * (checkbox obligatorio) y desde Mi perfil.
 */
const SECTIONS = [
  {
    h: '1. Qué datos juntamos',
    p: 'Juntamos los datos que nos das al registrarte y usar Oppi: nombre, email, teléfono, barrio, foto de perfil, los datos de tus reservas, mensajes dentro de la plataforma, reseñas y documentos de verificación si ofrecés servicios. También registramos datos técnicos mínimos para que la app funcione (modelo de dispositivo, versión del sistema) y tu ubicación aproximada solo cuando la necesitás para buscar servicios cercanos.',
  },
  {
    h: '2. Para qué los usamos',
    p: 'Usamos tus datos para operar la plataforma: crear tu cuenta, procesar reservas y pagos, mostrarte profesionales cercanos, enviarte avisos de tus turnos, prevenir fraudes y mejorar el servicio. Nunca vendemos tus datos a terceros.',
  },
  {
    h: '3. Con quién los compartimos',
    p: 'Compartimos lo mínimo necesario con: (a) el profesional o negocio con el que reservás (tu nombre, teléfono y detalle de la reserva); (b) los procesadores de pago, solo los datos de la transacción; (c) autoridades, únicamente cuando una ley lo exige. Fuera de eso, tus datos no se comparten.',
  },
  {
    h: '4. Tus derechos',
    p: 'Podés pedir en cualquier momento ver, corregir o eliminar tus datos personales. La eliminación se hace desde la app en Perfil → Eliminar mi cuenta: tus datos personales se anonimizan y perdés el acceso. Algunos registros (por ejemplo, comprobantes de pago) se conservan anonimizados por el plazo que exige la ley. Para ejercer tus derechos también podés escribirnos desde Ayuda y soporte.',
  },
  {
    h: '5. Notificaciones',
    p: 'Te enviamos avisos sobre tus reservas, mensajes y actividad de tu cuenta. Podés elegir qué tipos de avisos recibir desde Perfil → Notificaciones. Los avisos esenciales de seguridad (por ejemplo, cambios en tu cuenta) no se pueden desactivar.',
  },
  {
    h: '6. Seguridad',
    p: 'Protegemos tus datos con cifrado en tránsito, control de accesos y buenas prácticas de la industria. Ningún sistema es 100% seguro: si detectás un uso indebido de tu cuenta, avisanos enseguida desde la app.',
  },
  {
    h: '7. Menores',
    p: 'Oppi es para mayores de 18 años. Si sos menor, necesitás la autorización de un adulto responsable para usar la plataforma.',
  },
  {
    h: '8. Cambios y contacto',
    p: 'Podemos actualizar esta política; los cambios importantes se avisan en la app. Para consultas sobre privacidad escribinos desde Ayuda y soporte dentro de la app.',
  },
];

export function PrivacyScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.wrap}>
      <ScreenHeader title="Política de privacidad" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text style={styles.updated}>Última actualización: octubre 2026</Text>
        {SECTIONS.map((s) => (
          <View key={s.h} style={styles.section}>
            <Text style={styles.h}>{s.h}</Text>
            <Text style={styles.p}>{s.p}</Text>
          </View>
        ))}
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
});
