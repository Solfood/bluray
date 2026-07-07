import { useState } from 'react';
import { normalizeScanOrInput } from '../lib/movies';

const compressImageToBase64 = (file, maxPx = 600) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });

export function useServerLookup() {
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [movieData, setMovieData] = useState(null);
  const [searchCandidates, setSearchCandidates] = useState([]);
  const [scannedCode, setScannedCode] = useState('');
  const [userNote, setUserNote] = useState('');

  const reset = () => {
    setMovieData(null);
    setSearchCandidates([]);
    setScannedCode('');
    setUserNote('');
    setStatusMsg('');
    setLoading(false);
  };

  const selectMovieCandidate = (candidate, detectedEdition = '') => {
    if (!candidate) return;
    const merged = { ...candidate, note: candidate.note || detectedEdition || '' };
    setMovieData(merged);
    setUserNote(merged.note || '');
    setStatusMsg('Movie selected.');
  };

  const chooseCandidates = (candidates, detectedEdition = '') => {
    if (!candidates || candidates.length === 0) {
      setMovieData(null);
      setSearchCandidates([]);
      return;
    }
    if (candidates.length === 1) {
      setSearchCandidates(candidates);
      selectMovieCandidate(candidates[0], detectedEdition);
      return;
    }
    const [top, second] = candidates;
    setSearchCandidates(candidates.slice(0, 8));
    if (top._score >= 120 && (!second || top._score - second._score >= 25)) {
      selectMovieCandidate(top, detectedEdition);
    } else {
      setMovieData(null);
      setUserNote(detectedEdition || '');
      setStatusMsg('Multiple matches found. Choose the correct movie.');
    }
  };

  const search = async (query) => {
    const normalized = normalizeScanOrInput(query);
    if (!normalized) {
      setStatusMsg('Enter a title or UPC.');
      return;
    }
    setLoading(true);
    setStatusMsg('Searching...');
    setMovieData(null);
    setSearchCandidates([]);
    try {
      const res = await fetch(`/api/lookup?q=${encodeURIComponent(normalized)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`);
      if (data.status === 'not_found') {
        setStatusMsg('Barcode not found. Try title search or manual entry.');
      } else {
        setStatusMsg('Matches found.');
        chooseCandidates(data.candidates, data.detectedEdition);
      }
    } catch (e) {
      setStatusMsg(`Lookup failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const identifyFromCover = async (imageFile) => {
    setLoading(true);
    setStatusMsg('Identifying cover...');
    setMovieData(null);
    setSearchCandidates([]);
    try {
      const b64 = await compressImageToBase64(imageFile);
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: b64, media_type: 'image/jpeg' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Identify failed (${res.status})`);
      if (!data.identified) {
        setStatusMsg("Couldn't identify the cover. Try a clearer photo or type the title.");
        return;
      }
      const { title, year, edition } = data.identified;
      setStatusMsg(`Identified: "${title}". Searching...`);
      setScannedCode(title);
      if (edition) setUserNote(edition);
      if (data.candidates.length > 0) {
        chooseCandidates(data.candidates, edition);
      } else {
        chooseCandidates([{
          id: null, title, release_date: year ? `${year}-01-01` : '',
          overview: 'Identified from cover photo. No TMDB match found.',
          note: edition, _source: 'cover-photo', _score: 60,
        }], edition);
      }
    } catch (e) {
      setStatusMsg(`Cover ID failed: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleScan = (code) => {
    const normalized = normalizeScanOrInput(code);
    setScannedCode(normalized);
    if (normalized) search(normalized);
  };

  return {
    loading, statusMsg, movieData, searchCandidates, scannedCode, userNote,
    setScannedCode, setUserNote, handleScan, search, identifyFromCover,
    selectMovieCandidate, reset,
  };
}
