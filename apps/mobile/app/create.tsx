import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export default function CreateScreen() {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [imageStatus, setImageStatus] = useState<string>("No media selected yet.");

  async function pickFromLibrary() {
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ["images"]
    });

    if (!result.canceled) {
      setImageStatus(`Selected ${result.assets.length} photo(s) from the library.`);
    }
  }

  const cameraGranted = cameraPermission?.granted === true;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Create listing</Text>
      <View style={styles.card}>
        <Text style={styles.heading}>Camera-first intake</Text>
        <Text style={styles.copy}>
          The mobile app requests camera permissions for barcode scanning and listing photos, with a fallback to the photo library when access is denied.
        </Text>
        {cameraGranted ? (
          <View style={styles.cameraFrame}>
            <CameraView facing="back" style={StyleSheet.absoluteFill} />
          </View>
        ) : (
          <View style={styles.permissionBlock}>
            <Text style={styles.copy}>Camera permission not granted.</Text>
            <Pressable onPress={() => void requestCameraPermission()} style={styles.button}>
              <Text style={styles.buttonText}>Enable camera</Text>
            </Pressable>
          </View>
        )}
        <Pressable onPress={() => void pickFromLibrary()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Use photo library instead</Text>
        </Pressable>
        <Text style={styles.status}>{imageStatus}</Text>
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
    gap: 12
  },
  heading: {
    fontWeight: "600",
    fontSize: 16
  },
  copy: {
    color: "#4f4f4f",
    lineHeight: 22
  },
  cameraFrame: {
    height: 260,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#111"
  },
  permissionBlock: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: "#f5efe1",
    gap: 10
  },
  button: {
    backgroundColor: "#1b7f54",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignSelf: "flex-start"
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600"
  },
  secondaryButton: {
    backgroundColor: "#f1eee5",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    alignSelf: "flex-start"
  },
  secondaryText: {
    color: "#111",
    fontWeight: "600"
  },
  status: {
    color: "#725000"
  }
});
