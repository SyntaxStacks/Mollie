import { ScrollView, StyleSheet, Text, View } from "react-native";

export default function ActivityScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Activity</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Push and queue events</Text>
        <Text style={styles.copy}>
          Push notifications will surface MFA challenges, publish success/failure, queue attention states, and Poshmark social automation issues.
        </Text>
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
