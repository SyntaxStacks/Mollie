import { Link } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const sampleItems = [
  { id: "sample-poshmark-1", title: "Vintage varsity jacket", status: "Ready to post" },
  { id: "sample-poshmark-2", title: "Coach shoulder bag", status: "Queued" }
];

export default function InventoryScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Inventory</Text>
      {sampleItems.map((item) => (
        <Link asChild href={`/inventory/${item.id}`} key={item.id}>
          <Pressable style={styles.card}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemStatus}>{item.status}</Text>
          </Pressable>
        </Link>
      ))}
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
    borderColor: "#e6dfcf"
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "600"
  },
  itemStatus: {
    marginTop: 6,
    color: "#725000"
  }
});
