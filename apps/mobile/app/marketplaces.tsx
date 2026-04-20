import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function MarketplacesScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Marketplaces</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Poshmark hosted sign-in</Text>
        <Text style={styles.copy}>The mobile client launches a hosted remote-browser session to connect Poshmark for publishing and social automation.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Poshmark social automation</Text>
        <Text style={styles.copy}>Share closet cadence, share listings cadence, and send-offers-to-likers settings are configured against the same backend API used on web.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    gap: 12
  },
  title: {
    fontSize: 28,
    fontWeight: "700"
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e6dfcf",
    gap: 8
  },
  heading: {
    fontWeight: "600",
    fontSize: 16
  },
  copy: {
    color: "#4f4f4f",
    lineHeight: 22
  }
});
