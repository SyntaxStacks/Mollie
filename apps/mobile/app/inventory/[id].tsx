import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function InventoryDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Item {params.id}</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Poshmark remote automation</Text>
        <Text style={styles.copy}>Queue state, readiness blockers, challenge resume, and publish results all use the shared automation API.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>Mobile continuity</Text>
        <Text style={styles.copy}>A task started on web can be resumed here, including hosted challenge completion.</Text>
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
