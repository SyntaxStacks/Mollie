import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const quickLinks = [
  { href: "/inventory", label: "Inventory" },
  { href: "/create", label: "Create listing" },
  { href: "/marketplaces", label: "Marketplaces" },
  { href: "/activity", label: "Activity" }
] as const;

export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.eyebrow}>Mobile resale operations</Text>
      <Text style={styles.title}>Mollie mobile</Text>
      <Text style={styles.copy}>
        Full mobile parity for inventory, marketplace connect, Poshmark remote automation, scan-first intake, and challenge handling.
      </Text>
      <View style={styles.grid}>
        {quickLinks.map((link) => (
          <Link asChild href={link.href} key={link.href}>
            <Pressable style={styles.card}>
              <Text style={styles.cardTitle}>{link.label}</Text>
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 16
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#8c5d00",
    fontSize: 12,
    fontWeight: "700"
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: "#111111"
  },
  copy: {
    color: "#4f4f4f",
    fontSize: 16,
    lineHeight: 24
  },
  grid: {
    gap: 12
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e6dfcf"
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600"
  }
});
