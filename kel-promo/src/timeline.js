// 영상과 음악이 함께 쓰는 타임라인입니다. 단위: 초 (120 BPM → 1박 0.5초, 1마디 2초)
// scripts/make_audio.py가 이 파일의 JSON 부분을 읽어 같은 시각에 효과음을 배치합니다.
window.TL = {
  "fps": 60,
  "bpm": 120,
  "duration": 132,
  "freezeAt": 124,
  "sections": [
    { "id": "hook",   "start": 0,   "end": 12,  "label": "" },
    { "id": "intro",  "start": 12,  "end": 20,  "label": "01 / CHAMPIONSHIP" },
    { "id": "map",    "start": 20,  "end": 32,  "label": "02 / YOUR TEAM" },
    { "id": "teamsA", "start": 32,  "end": 56,  "label": "02 / YOUR TEAM" },
    { "id": "lumia",  "start": 56,  "end": 64,  "label": "03 / BATTLEFIELD" },
    { "id": "teamsB", "start": 64,  "end": 88,  "label": "02 / YOUR TEAM" },
    { "id": "road",   "start": 88,  "end": 100, "label": "04 / ROAD TO THE FINAL" },
    { "id": "venue",  "start": 100, "end": 108, "label": "05 / FINAL STAGE" },
    { "id": "rally",  "start": 108, "end": 116, "label": "06 / SEASON 16" },
    { "id": "cta",    "start": 116, "end": 132, "label": "07 / SEE YOU THERE" }
  ],
  "teamOrder": [13, 10, 4, 12, 1, 2, 11, 8, 16, 14, 3, 7, 15, 9, 6, 5],
  "teamStartA": 32,
  "teamStartB": 64,
  "teamDur": 3,
  "teamTravel": 0.45,
  "hookWords": [0.8, 2.4, 4.2],
  "hookNums": [6.0, 6.25, 6.5, 6.75],
  "logoHit": 8.0,
  "pinDropStart": 21.5,
  "pinDropStep": 0.25,
  "roadHits": [88.0, 90.0, 91.5, 93.5, 95.5],
  "venueHit": 100.0,
  "rallyHits": [108.0, 112.0, 113.0],
  "ctaHit": 116.0,
  "ctaTicks": [116.5, 117.0, 117.5, 118.0, 118.5]
};
