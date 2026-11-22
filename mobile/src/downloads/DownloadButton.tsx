import { Alert, StyleSheet, Text, View } from "react-native";
import { formatBytes } from "../lib/format";
import { Button, ProgressBar } from "../ui/components";
import { colors, space } from "../ui/theme";
import { useDownloads, type DownloadItem } from "./DownloadsProvider";
import { daysLeft } from "./licenses";

export function DownloadButton({ item }: { item: DownloadItem }) {
  const downloads = useDownloads();
  const record = downloads.records.find((r) => r.videoId === item.videoId);
  const active = downloads.active[item.videoId];
  const error = downloads.errors[item.videoId];

  if (active) {
    return (
      <View style={styles.box}>
        <Text style={styles.text}>{active.phase === "preparing" ? "Preparing the download… this can take a minute or two" : `Downloading… ${active.percent}%`}</Text>
        <ProgressBar value={active.percent} />
        <Button title="Cancel" variant="quiet" onPress={() => downloads.cancel(item.videoId)} style={{ alignSelf: "flex-start", marginTop: space(1) }} />
      </View>
    );
  }
  if (record) {
    const days = daysLeft(record, new Date());
    return (
      <View style={styles.box}>
        <Text style={styles.text}>
          Downloaded{record.sizeBytes ? ` · ${formatBytes(record.sizeBytes)}` : ""} · plays offline for {days} {days === 1 ? "more day" : "more days"}
        </Text>
        <Button
          title="Remove download"
          variant="quiet"
          style={{ alignSelf: "flex-start" }}
          onPress={() =>
            Alert.alert("Remove download?", "You can download it again any time.", [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => void downloads.remove(item.videoId) },
            ])
          }
        />
      </View>
    );
  }
  return (
    <View style={{ marginTop: space(4) }}>
      <Button title="Download to watch offline" variant="secondary" onPress={() => void downloads.download(item)} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginTop: space(4), padding: space(3), borderRadius: 10, backgroundColor: colors.white, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line },
  text: { fontSize: 14, color: colors.navy800 },
  error: { color: colors.danger, marginTop: space(2), fontSize: 14 },
});
