import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: "#ffffff"
          },
          headerTitleStyle: {
            fontWeight: "600"
          },
          contentStyle: {
            backgroundColor: "#f6f4ee"
          }
        }}
      />
    </>
  );
}
