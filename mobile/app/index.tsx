import { Redirect } from "expo-router";
import { View } from "react-native";
import { useAuth } from "../src/auth/AuthProvider";
import { Loading } from "../src/ui/components";
import { colors } from "../src/ui/theme";

/** Opening the app: home when signed in, otherwise sign in. */
export default function Index() {
  const auth = useAuth();
  if (auth.status === "loading") {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper, justifyContent: "center" }}>
        <Loading />
      </View>
    );
  }
  return <Redirect href={auth.status === "signedIn" ? "/(app)/(tabs)" : "/sign-in"} />;
}
