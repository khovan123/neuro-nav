/* ============================================================
   TEAM PAGE — Collaboration management
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { setMyPeerInfo, setPeers, addIncomingShare, dismissIncomingShare } from '@/store';
import * as p2p from '@/infrastructure/p2p/peerService';
import { shareCurrentTabs, openSharedWorkspace } from '@/core/use-cases/shareWorkspace';
import type { SharedWorkspace } from '@/core/entities/Peer';
import { Badge } from '@/shared/ui/Badge';
import { IconPeers, IconClose, IconCheck, IconInbox } from '@/shared/ui/Icons';

export function Peers() {
  const dispatch = useAppDispatch();
  const { myPeerId, peers, incomingShares, initialized } = useAppSelector((s) => s.peers);
  const [connectId, setConnectId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Initialize P2P on mount
  useEffect(() => {
    if (initialized) return;

    p2p.initP2P().then((id) => {
      dispatch(setMyPeerInfo({ peerId: id, displayName: id }));
    }).catch((err) => {
      setError(`P2P init failed: ${err.message}`);
    });

    // Register handler for incoming workspace shares
    const unsub = p2p.onMessage('SHARE_WORKSPACE', (message) => {
      dispatch(addIncomingShare(message.payload as SharedWorkspace));
    });

    return () => { unsub(); };
  }, [initialized, dispatch]);

  // Poll peers list
  useEffect(() => {
    if (!initialized) return;
    const interval = setInterval(() => {
      dispatch(setPeers(p2p.getConnectedPeers()));
    }, 2000);
    return () => clearInterval(interval);
  }, [initialized, dispatch]);

  const handleConnect = useCallback(async () => {
    const id = connectId.trim();
    if (!id) return;

    setConnecting(true);
    setError('');
    try {
      await p2p.connectToPeer(id);
      dispatch(setPeers(p2p.getConnectedPeers()));
      setConnectId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }, [connectId, dispatch]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(myPeerId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [myPeerId]);

  const handleShare = useCallback(async (remotePeerId: string) => {
    try {
      await shareCurrentTabs(remotePeerId, `Shared from ${myPeerId}`);
    } catch (err) {
      console.error('Share failed:', err);
    }
  }, [myPeerId]);

  const handleAcceptShare = useCallback(async (index: number) => {
    const share = incomingShares[index];
    if (share) {
      await openSharedWorkspace(share);
      dispatch(dismissIncomingShare(index));
    }
  }, [incomingShares, dispatch]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* My Peer ID */}
      <div className="px-3 py-3 border-b border-border-subtle">
        <div className="text-[10px] text-text-tertiary mb-1">Your ID — share this to connect</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-surface-overlay px-2.5 py-1.5 rounded-md font-mono text-xs text-accent-secondary truncate">
            {myPeerId || '…'}
          </div>
          <button
            onClick={handleCopyId}
            disabled={!myPeerId}
            className="px-2.5 py-1.5 text-[10px] font-medium rounded-md bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors disabled:opacity-30 cursor-pointer"
          >
            {copied ? <><IconCheck size={10} className="inline -mt-0.5" /> Copied</> : 'Copy'}
          </button>
        </div>
        {!initialized && (
          <div className="mt-2 text-[10px] text-accent-warning animate-pulse">Setting up connection…</div>
        )}
      </div>

      {/* Connect to peer */}
      <div className="px-3 py-3 border-b border-border-subtle">
        <div className="text-[10px] text-text-tertiary mb-1">Connect to someone</div>
        <div className="flex items-center gap-2">
          <input
            value={connectId}
            onChange={(e) => setConnectId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
            placeholder="Paste their ID here…"
            className="flex-1 bg-surface-overlay px-2.5 py-1.5 rounded-md text-xs text-text-primary placeholder:text-text-tertiary outline-none border border-transparent focus:border-accent-primary/40 transition-colors"
            id="peer-connect-input"
          />
          <button
            onClick={handleConnect}
            disabled={!connectId.trim() || connecting}
            className="px-2.5 py-1.5 text-[10px] font-medium rounded-md bg-accent-primary text-text-inverse hover:bg-accent-primary-hover transition-colors disabled:opacity-30 cursor-pointer"
          >
            {connecting ? '…' : 'Connect'}
          </button>
        </div>
        {error && (
          <div className="mt-1.5 text-[10px] text-accent-danger">{error}</div>
        )}
      </div>

      {/* Connected Peers */}
      <div className="flex-1 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
            Connected ({peers.filter((p) => p.status === 'connected').length})
          </span>
        </div>

        {peers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-text-tertiary animate-fade-in">
            <IconPeers size={28} className="mb-2 opacity-30" />
            <p className="text-xs text-center">No one connected yet</p>
            <p className="text-[10px] mt-1 text-center px-4">
              Share your ID with a teammate, or paste theirs above to connect.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5 animate-fade-in">
            {peers.map((peer) => (
              <div
                key={peer.peerId}
                className="card-interactive px-3 py-2 flex items-center justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={[
                    'status-dot shrink-0',
                    peer.status === 'connected' ? 'status-dot-active' : 'status-dot-idle',
                  ].join(' ')} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-text-primary truncate">
                      {peer.displayName}
                    </div>
                    <div className="text-[10px] text-text-tertiary font-mono truncate">
                      {peer.peerId}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Badge variant={peer.status === 'connected' ? 'success' : 'default'}>
                    {peer.status === 'connected' ? 'Online' : 'Offline'}
                  </Badge>
                  {peer.status === 'connected' && (
                    <button
                      onClick={() => handleShare(peer.peerId)}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-accent-secondary/15 text-accent-secondary hover:bg-accent-secondary/25 transition-colors cursor-pointer"
                    >
                      Share Tabs
                    </button>
                  )}
                  <button
                    onClick={() => {
                      p2p.disconnectPeer(peer.peerId);
                      dispatch(setPeers(p2p.getConnectedPeers()));
                    }}
                    className="p-1 text-text-tertiary hover:text-accent-danger transition-colors cursor-pointer"
                    title="Disconnect"
                  >
                    <IconClose size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incoming Shares */}
      {incomingShares.length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle">
          <div className="text-[10px] font-medium text-accent-warning mb-1.5">
            <IconInbox size={12} className="inline -mt-0.5" /> Shared with you ({incomingShares.length})
          </div>
          <div className="space-y-1.5">
            {incomingShares.map((share, i) => (
              <div key={i} className="glass-panel px-3 py-2 animate-slide-in">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-medium text-text-primary">{share.name}</div>
                    <div className="text-[10px] text-text-tertiary">
                      {share.tabs.length} tabs from {share.sharedBy}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleAcceptShare(i)}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-accent-success/15 text-accent-success hover:bg-accent-success/25 transition-colors cursor-pointer"
                    >
                      Open
                    </button>
                    <button
                      onClick={() => dispatch(dismissIncomingShare(i))}
                      className="p-1 text-text-tertiary hover:text-accent-danger transition-colors cursor-pointer"
                    >
                      <IconClose size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
