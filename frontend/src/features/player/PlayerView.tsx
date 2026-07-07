import { LibraryView } from "./LibraryView";
import { HomeView } from "./HomeView";
import { RadioView } from "./RadioView";
import { NeteaseView } from "./NeteaseView";
import { QqMusicView } from "./QqMusicView";
import { SpotifyView } from "./SpotifyView";
import { GequbaoView } from "./GequbaoView";
import { KugouView } from "./KugouView";
import { KuwoView } from "./KuwoView";
import { QishuiView } from "./QishuiView";
import { PodcastView } from "./PodcastView";
import { UserPlaylistView } from "./UserPlaylistView";
import { SearchView } from "./SearchView";
import { WallpaperView } from "./WallpaperView";
import { usePlayerStore } from "../../stores/playerStore";
import "../../styles/player.css";

export function PlayerView() {
  const subView = usePlayerStore((s) => s.subView);

  return (
    <div className="player-view">
      {subView === "home" ? (
        <HomeView />
      ) : subView === "wallpaper" ? (
        <WallpaperView />
      ) : subView === "search" ? (
        <SearchView />
      ) : subView === "radio" ? (
        <RadioView />
      ) : subView === "netease" ? (
        <NeteaseView />
      ) : subView === "qqmusic" ? (
        <QqMusicView />
      ) : subView === "spotify" ? (
        <SpotifyView />
      ) : subView === "gequbao" ? (
        <GequbaoView />
      ) : subView === "kugou" ? (
        <KugouView />
      ) : subView === "kuwo" ? (
        <KuwoView />
      ) : subView === "qishui" ? (
        <QishuiView />
      ) : subView === "podcast" ? (
        <PodcastView />
      ) : subView === "user_playlist" ? (
        <UserPlaylistView />
      ) : (
        <LibraryView />
      )}
    </div>
  );
}
