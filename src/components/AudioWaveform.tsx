import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { 
  Play, Square, SkipBack, SkipForward, Volume2, VolumeX, 
  ZoomIn, ZoomOut, Repeat, Repeat1, Upload, Pause, Shuffle, 
  Trash2, ListMusic, Rewind, FastForward 
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for shadcn-like class merging
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type PlaylistItem = {
  id: string;
  file: File;
  url: string;
  name: string;
  duration: string;
};

// Helper to get audio duration without playing it
const getAudioDuration = (url: string): Promise<string> => {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration && audio.duration !== Infinity && !isNaN(audio.duration)) {
        const mins = Math.floor(audio.duration / 60);
        const secs = Math.floor(audio.duration % 60);
        resolve(`${mins}:${secs.toString().padStart(2, '0')}`);
      } else {
        resolve('--:--');
      }
    });
    audio.addEventListener('error', () => resolve('--:--'));
  });
};

export default function AudioWaveform() {
  // Refs for DOM elements and WaveSurfer instances
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);

  // State management
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [zoom, setZoom] = useState(10);
  const [isDragging, setIsDragging] = useState(false);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [duration, setDuration] = useState('0:00');
  
  // Loop & Repeat States
  const [loopRegion, setLoopRegion] = useState<{ start: number; end: number } | null>(null);
  const [isABLooping, setIsABLooping] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'OFF' | 'ALL' | 'ONE'>('OFF');
  
  // Playlist State
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isShuffle, setIsShuffle] = useState(false);

  // Refs for callbacks to avoid stale closures
  const playlistRef = useRef(playlist);
  const currentIndexRef = useRef(currentIndex);
  const isShuffleRef = useRef(isShuffle);
  const repeatModeRef = useRef(repeatMode);
  const isABLoopingRef = useRef(isABLooping);
  const shouldAutoPlayRef = useRef(false);

  useEffect(() => {
    playlistRef.current = playlist;
    currentIndexRef.current = currentIndex;
    isShuffleRef.current = isShuffle;
    repeatModeRef.current = repeatMode;
    isABLoopingRef.current = isABLooping;
  }, [playlist, currentIndex, isShuffle, repeatMode, isABLooping]);

  const currentTrackUrl = playlist[currentIndex]?.url;

  // Initialize WaveSurfer when the current track changes
  useEffect(() => {
    if (!containerRef.current || !timelineRef.current || !currentTrackUrl) return;

    // Destroy previous instance if it exists
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
    }

    // Create WaveSurfer instance with FL Studio inspired colors
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4b5563', // gray-600
      progressColor: '#f97316', // orange-500
      cursorColor: '#f97316',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 128,
      normalize: true,
      minPxPerSec: zoom,
      plugins: [
        TimelinePlugin.create({
          container: timelineRef.current,
          height: 24,
          style: {
            fontSize: '12px',
            color: '#9ca3af', // gray-400
          },
        }),
      ],
    });

    // Initialize Regions plugin for A-B looping
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsRef.current = regions;

    regions.enableDragSelection({
      color: 'rgba(249, 115, 22, 0.2)', // orange-500 with opacity
    });

    // Handle region creation (keep only one region for A-B looping)
    regions.on('region-created', (region) => {
      regions.getRegions().forEach((r) => {
        if (r.id !== region.id) r.remove();
      });
      setLoopRegion({ start: region.start, end: region.end });
      // Auto-enable A-B loop when a region is drawn
      setIsABLooping(true);
    });

    regions.on('region-updated', (region) => {
      setLoopRegion({ start: region.start, end: region.end });
    });

    // WaveSurfer event listeners
    ws.on('ready', () => {
      setDuration(formatTime(ws.getDuration()));
      ws.setVolume(isMuted ? 0 : volume);
      
      // Auto-play if triggered by next/prev or playlist click
      if (shouldAutoPlayRef.current) {
        ws.play();
        shouldAutoPlayRef.current = false;
      }
    });

    ws.on('timeupdate', (currentTimeVal) => {
      setCurrentTime(formatTime(currentTimeVal));
      
      // Handle A-B looping logic
      if (isABLoopingRef.current && regionsRef.current) {
        const activeRegions = regionsRef.current.getRegions();
        if (activeRegions.length > 0) {
          const region = activeRegions[0];
          // If playhead reaches or passes the end of the region, jump back to start
          if (currentTimeVal >= region.end) {
            ws.setTime(region.start);
          }
        }
      }
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    
    // Handle track finish (Repeat Mode logic)
    ws.on('finish', () => {
      const pList = playlistRef.current;
      const cIndex = currentIndexRef.current;
      const shuffle = isShuffleRef.current;
      const rMode = repeatModeRef.current;
      
      if (pList.length === 0) {
        setIsPlaying(false);
        return;
      }

      // 1. Single Loop Mode: Repeat the exact same song
      if (rMode === 'ONE') {
        ws.play();
        return;
      }

      // 2. Shuffle Mode
      if (shuffle) {
        let nextIdx = Math.floor(Math.random() * pList.length);
        if (nextIdx === cIndex && pList.length > 1) {
          nextIdx = (nextIdx + 1) % pList.length;
        }
        shouldAutoPlayRef.current = true;
        setCurrentIndex(nextIdx);
        return;
      } 
      
      // 3. Normal / Playlist Loop Mode
      const isLast = cIndex === pList.length - 1;
      if (isLast && rMode === 'OFF') {
        // Disabled Mode: Stop playing at the end of the playlist
        setIsPlaying(false);
        ws.setTime(0);
      } else {
        // Enabled Mode (ALL): Go to next song, loop back to start if at the end
        shouldAutoPlayRef.current = true;
        setCurrentIndex((cIndex + 1) % pList.length);
      }
    });

    // Load the audio file
    ws.load(currentTrackUrl);
    wavesurferRef.current = ws;

    // Cleanup on unmount or track change
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      setLoopRegion(null);
      setIsABLooping(false);
    };
  }, [currentTrackUrl]); // Only re-init when the track URL changes

  // Enforce A-B loop bounds if toggled on while outside the region
  useEffect(() => {
    if (isABLooping && loopRegion && wavesurferRef.current) {
      const currentPos = wavesurferRef.current.getCurrentTime();
      if (currentPos > loopRegion.end || currentPos < loopRegion.start) {
        wavesurferRef.current.setTime(loopRegion.start);
      }
    }
  }, [isABLooping, loopRegion]);

  // Update zoom level
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.zoom(zoom);
    }
  }, [zoom]);

  // Update volume and mute state
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(isMuted ? 0 : volume);
    }
  }, [volume, isMuted]);

  // Format seconds into M:SS
  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- Transport Controls ---
  const handlePlayPause = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  const handleStop = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.pause();
      wavesurferRef.current.setTime(0);
    }
  };

  const handleSkipForward = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.skip(5);
    }
  };

  const handleSkipBackward = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.skip(-5);
    }
  };

  // --- Playlist Controls ---
  const playNext = () => {
    if (playlist.length === 0) return;
    shouldAutoPlayRef.current = true;
    if (isShuffle) {
      let nextIdx = Math.floor(Math.random() * playlist.length);
      if (nextIdx === currentIndex && playlist.length > 1) {
        nextIdx = (nextIdx + 1) % playlist.length;
      }
      setCurrentIndex(nextIdx);
    } else {
      setCurrentIndex((prev) => (prev + 1) % playlist.length);
    }
  };

  const playPrev = () => {
    if (playlist.length === 0) return;
    shouldAutoPlayRef.current = true;
    setCurrentIndex((prev) => (prev - 1 + playlist.length) % playlist.length);
  };

  const playTrack = (index: number) => {
    if (index === currentIndex) {
      handlePlayPause();
      return;
    }
    shouldAutoPlayRef.current = true;
    setCurrentIndex(index);
  };

  const clearPlaylist = () => {
    setPlaylist([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    setLoopRegion(null);
    setIsABLooping(false);
    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }
  };

  // --- File Upload Handlers ---
  const handleFiles = async (files: FileList | File[]) => {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
    if (audioFiles.length === 0) return;

    const newTracks = await Promise.all(audioFiles.map(async (file) => {
      const url = URL.createObjectURL(file);
      const duration = await getAudioDuration(url);
      return {
        id: Math.random().toString(36).substring(7),
        file,
        url,
        name: file.name,
        duration
      };
    }));

    setPlaylist(prev => {
      const updated = [...prev, ...newTracks];
      // If playlist was empty, start playing the first added track
      if (prev.length === 0) {
        shouldAutoPlayRef.current = true;
        setCurrentIndex(0);
      }
      return updated;
    });
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    // Only set dragging to false if we are leaving the main container
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  return (
    <div 
      className="relative flex flex-col md:flex-row w-full max-w-6xl mx-auto bg-zinc-950 text-zinc-100 md:rounded-xl md:border border-zinc-800 shadow-2xl overflow-hidden font-sans h-[100dvh] md:h-[600px]"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Global Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-orange-500/10 backdrop-blur-sm border-2 border-orange-500 border-dashed m-4 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="bg-zinc-900 p-6 rounded-xl shadow-2xl flex flex-col items-center">
            <Upload className="w-12 h-12 text-orange-500 mb-4" />
            <h3 className="text-xl font-bold text-zinc-100">Drop audio files here</h3>
            <p className="text-zinc-400 mt-2">Add to playlist</p>
          </div>
        </div>
      )}

      {/* Main Player Area */}
      <div className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-zinc-900 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-4">
            <div className="w-3 h-3 rounded-full bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)] shrink-0"></div>
            <h2 className="text-sm font-semibold tracking-wider text-zinc-300 uppercase truncate">
              {playlist[currentIndex]?.name || "WaveForge"}
            </h2>
          </div>
          <div className="text-xs font-mono text-zinc-500 shrink-0">
            {currentTime} / {duration}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 md:gap-6 overflow-y-auto">
          
          {playlist.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 p-4 text-center">
              <Upload className="w-12 h-12 text-zinc-600 mb-4" />
              <p className="text-zinc-400 font-medium">Drag & drop audio files anywhere</p>
              <p className="text-zinc-600 text-sm mt-1">MP3, WAV, OGG supported</p>
              <label className="mt-6 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-md cursor-pointer transition-colors text-sm font-medium">
                Browse Files
                <input type="file" multiple className="hidden" accept="audio/*" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
              </label>
            </div>
          ) : !currentTrackUrl ? (
            <div className="flex-1 flex items-center justify-center text-zinc-500 text-center p-4">
              Select a track from the playlist to start playing
            </div>
          ) : (
            <>
              {/* Waveform Area */}
              <div className="flex flex-col gap-1">
                <div 
                  ref={timelineRef} 
                  className={cn(
                    "w-full transition-all duration-200",
                    zoom > 10 ? "h-0 opacity-0 overflow-hidden" : "h-6 opacity-70"
                  )} 
                />
                <div 
                  ref={containerRef} 
                  className="w-full bg-zinc-900 rounded-md border border-zinc-800 overflow-hidden relative"
                />
                <div className="flex justify-between text-[10px] text-zinc-500 mt-1 uppercase tracking-widest px-1">
                  <span className="truncate mr-2">Drag to create loop region</span>
                  {loopRegion && (
                    <span className="shrink-0">Loop: {formatTime(loopRegion.start)} - {formatTime(loopRegion.end)}</span>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="flex flex-col gap-4 p-4 bg-zinc-900 rounded-lg border border-zinc-800 mt-auto shrink-0">
                
                {/* Top Row: Secondary (Left) & Primary (Center) */}
                <div className="flex flex-col xl:flex-row items-center justify-between gap-4">
                  
                  {/* Secondary Transport (Top Left) */}
                  <div className="flex items-center justify-start gap-1 w-full xl:w-1/3">
                    <button onClick={handleStop} className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Stop">
                      <Square className="w-4 h-4 fill-current" />
                    </button>
                    <button onClick={handleSkipBackward} className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Backward 5s">
                      <Rewind className="w-4 h-4 fill-current" />
                    </button>
                    <button onClick={handleSkipForward} className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Forward 5s">
                      <FastForward className="w-4 h-4 fill-current" />
                    </button>
                  </div>

                  {/* Primary Transport (Center) */}
                  <div className="flex items-center justify-center gap-1 sm:gap-2 w-full xl:w-1/3">
                    <button 
                      onClick={() => setIsShuffle(!isShuffle)}
                      className={cn("p-2 rounded-md transition-colors", isShuffle ? "text-orange-500 bg-orange-500/10" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100")}
                      title="Shuffle"
                    >
                      <Shuffle className="w-4 h-4 sm:w-5 sm:h-5" />
                    </button>
                    
                    <button onClick={playPrev} className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Previous Track">
                      <SkipBack className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>
                    
                    <button 
                      onClick={handlePlayPause}
                      className="flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-orange-500 hover:bg-orange-400 text-zinc-950 shadow-[0_0_15px_rgba(249,115,22,0.3)] transition-all hover:scale-105 active:scale-95 mx-1 sm:mx-2 shrink-0"
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? <Pause className="w-6 h-6 sm:w-7 sm:h-7 fill-current" /> : <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current ml-1" />}
                    </button>
                    
                    <button onClick={playNext} className="p-2 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors" title="Next Track">
                      <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>

                    {/* Playlist Repeat Mode Toggle */}
                    <button 
                      onClick={() => {
                        const nextMode = repeatMode === 'OFF' ? 'ALL' : repeatMode === 'ALL' ? 'ONE' : 'OFF';
                        setRepeatMode(nextMode);
                      }}
                      className={cn("p-2 rounded-md transition-colors", repeatMode !== 'OFF' ? "text-orange-500 bg-orange-500/10" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100")}
                      title={`Repeat: ${repeatMode}`}
                    >
                      {repeatMode === 'ONE' ? <Repeat1 className="w-4 h-4 sm:w-5 sm:h-5" /> : <Repeat className="w-4 h-4 sm:w-5 sm:h-5" />}
                    </button>

                    {/* A-B Region Loop Toggle */}
                    <button 
                      onClick={() => setIsABLooping(!isABLooping)}
                      disabled={!loopRegion}
                      className={cn(
                        "px-2 py-1 ml-1 text-[10px] sm:text-xs font-bold rounded-md transition-colors border shrink-0", 
                        !loopRegion ? "opacity-50 cursor-not-allowed border-zinc-800 text-zinc-600" :
                        isABLooping ? "text-orange-500 border-orange-500 bg-orange-500/10" : "text-zinc-400 border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
                      )}
                      title="Toggle A-B Loop Region"
                    >
                      A-B
                    </button>
                  </div>

                  {/* Spacer for Desktop Alignment */}
                  <div className="hidden xl:block w-1/3"></div>
                </div>

                {/* Bottom Row: Volume & Zoom (Bottom Right) */}
                <div className="flex flex-col sm:flex-row items-end sm:items-center justify-end gap-4 sm:gap-6 w-full border-t border-zinc-800 pt-4">
                  {/* Volume */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setIsMuted(!isMuted)}
                      className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                      {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <input 
                      type="range" 
                      min="0" 
                      max="1" 
                      step="0.01" 
                      value={isMuted ? 0 : volume}
                      onChange={(e) => {
                        setVolume(parseFloat(e.target.value));
                        if (isMuted) setIsMuted(false);
                      }}
                      className="w-24 sm:w-32 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                  </div>

                  {/* Zoom */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setZoom(Math.max(1, zoom - 10))}
                      className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <input 
                      type="range" 
                      min="1" 
                      max="200" 
                      value={zoom}
                      onChange={(e) => setZoom(parseInt(e.target.value))}
                      className="w-24 sm:w-32 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-orange-500"
                    />
                    <button 
                      onClick={() => setZoom(Math.min(200, zoom + 10))}
                      className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </div>

      {/* Playlist Sidebar */}
      <div className="w-full md:w-80 bg-zinc-900 border-t md:border-t-0 md:border-l border-zinc-800 flex flex-col shrink-0 h-1/3 md:h-auto min-h-[200px]">
        <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-2 text-zinc-300">
            <ListMusic className="w-4 h-4" />
            <span className="text-xs font-bold tracking-wider uppercase">Playlist</span>
            <span className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded-full text-zinc-400 ml-1">
              {playlist.length}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <label className="cursor-pointer text-zinc-400 hover:text-zinc-100 transition-colors" title="Add files">
              <Upload className="w-4 h-4" />
              <input type="file" multiple className="hidden" accept="audio/*" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
            </label>
            <button 
              onClick={clearPlaylist} 
              className="text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:text-zinc-400" 
              title="Clear Playlist"
              disabled={playlist.length === 0}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {/* Playlist Items */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {playlist.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-zinc-500 text-xs text-center p-4">
              <p>Your playlist is empty.</p>
              <p className="mt-2 opacity-70">Drag files here to add them.</p>
            </div>
          ) : (
            playlist.map((track, idx) => (
              <div 
                key={track.id}
                onClick={() => playTrack(idx)} 
                className={cn(
                  "flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors group text-sm",
                  idx === currentIndex 
                    ? "bg-zinc-800 text-orange-500" 
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                )}
              >
                <div className="w-4 flex justify-center shrink-0">
                  {idx === currentIndex ? (
                    <Play className="w-3 h-3 fill-current" />
                  ) : (
                    <span className="text-[10px] opacity-0 group-hover:opacity-100">{idx + 1}</span>
                  )}
                </div>
                {/* Truncated title container */}
                <div className="flex-1 min-w-0 truncate font-medium text-xs" title={track.name}>
                  {track.name}
                </div>
                <div className="text-[10px] font-mono opacity-60 shrink-0">
                  {track.duration}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
