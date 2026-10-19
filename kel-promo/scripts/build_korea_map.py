"""KOSTAT 2018 시도 경계(GeoJSON, WGS84)를 영상용 SVG 경로 데이터로 변환합니다.

출력: src/korea_map.js  (window.KOREA = {width, height, provinces:[...], teams:[...]})
투영: 위도 36도 기준 등장방형 투영(경도에 cos(36°) 보정). 국가 단위 지도에 충분한 정확도입니다.
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/data/skorea-provinces-2018-geo.json"
OUT = ROOT / "src/korea_map.js"

# 지도 캔버스(px). 카메라 확대를 고려해 넉넉한 해상도로 만듭니다.
W, H = 1000, 1180
PAD = 30
LAT0 = math.radians(36.0)
TOL = 0.55  # 단순화 허용 오차(px)
MIN_AREA = 6.0  # 이보다 작은 섬(px^2)은 제외. 독도는 별도로 유지합니다.

# 시즌 참가 16팀 · 공식 국문 팀명과 연고 (제작 브리프 3장, 공식 종합 안내 [2] 기준)
# kind: city = 시 단위 연고(핀), province = 도/광역 단위 연고(영역 강조)
TEAMS = [
    dict(no=1, name="GC 부산 스텔라", home="부산광역시", short="부산", en="BUSAN", code="21", kind="metro", lon=129.0756, lat=35.1796),
    dict(no=2, name="대구 가디언즈", home="대구광역시", short="대구", en="DAEGU", code="22", kind="metro", lon=128.6014, lat=35.8714),
    dict(no=3, name="인천 웨이브", home="인천광역시", short="인천", en="INCHEON", code="23", kind="metro", lon=126.7052, lat=37.4563),
    dict(no=4, name="광주 슬래셔", home="광주광역시", short="광주", en="GWANGJU", code="24", kind="metro", lon=126.8526, lat=35.1595),
    dict(no=5, name="대전 오토암즈", home="대전광역시", short="대전", en="DAEJEON", code="25", kind="metro", lon=127.3845, lat=36.3504),
    dict(no=6, name="FN 세종", home="세종특별자치시", short="세종", en="SEJONG", code="29", kind="metro", lon=127.2890, lat=36.4800),
    dict(no=7, name="경기 이네이트", home="경기도", short="경기", en="GYEONGGI", code="31", kind="province", lon=127.3000, lat=37.1500),
    dict(no=8, name="뉴 라이즈 강원", home="강원특별자치도", short="강원", en="GANGWON", code="32", kind="province", lon=128.3000, lat=37.7200),
    dict(no=9, name="충남 CNJ 이스포츠", home="충청남도", short="충남", en="CHUNGNAM", code="34", kind="province", lon=126.8500, lat=36.5200),
    dict(no=10, name="전라남도 이스포츠", home="전라남도", short="전남", en="JEONNAM", code="36", kind="province", lon=126.9500, lat=34.8600),
    dict(no=11, name="경북 어센더스", home="경상북도", short="경북", en="GYEONGBUK", code="37", kind="province", lon=128.7500, lat=36.3500),
    dict(no=12, name="경남 스파클 이스포츠", home="경상남도", short="경남", en="GYEONGNAM", code="38", kind="province", lon=128.2500, lat=35.3000),
    dict(no=13, name="제주 쉐도우", home="제주특별자치도", short="제주", en="JEJU", code="39", kind="province", lon=126.5500, lat=33.3800),
    dict(no=14, name="고양 미르", home="경기도 고양시", short="고양", en="GOYANG", code="31", kind="city", lon=126.8320, lat=37.6584),
    dict(no=15, name="성남 락스", home="경기도 성남시", short="성남", en="SEONGNAM", code="31", kind="city", lon=127.1267, lat=37.4200),
    dict(no=16, name="양주 웨일즈", home="경기도 양주시", short="양주", en="YANGJU", code="31", kind="city", lon=127.0458, lat=37.7853),
]

# 결승 장소: 대전 이스포츠 경기장(대전광역시). 핀은 대전 도심 기준 위치입니다.
VENUE = dict(lon=127.3845, lat=36.3504)


def raw_xy(lon, lat):
    return (math.radians(lon) * math.cos(LAT0), -math.radians(lat))


def ring_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def dp(pts, tol):
    """Douglas-Peucker (반복형)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def main():
    gj = json.loads(SRC.read_text())
    rings_by_prov = []
    xs, ys = [], []
    for f in gj["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        rings = []
        for poly in polys:
            for ring in poly:
                pts = [raw_xy(lon, lat) for lon, lat in ring]
                rings.append(pts)
                for x, y in pts:
                    xs.append(x)
                    ys.append(y)
        rings_by_prov.append((f["properties"], rings))

    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    s = min((W - 2 * PAD) / (maxx - minx), (H - 2 * PAD) / (maxy - miny))
    ox = PAD + ((W - 2 * PAD) - (maxx - minx) * s) / 2
    oy = PAD + ((H - 2 * PAD) - (maxy - miny) * s) / 2

    def proj(x, y):
        return ((x - minx) * s + ox, (y - miny) * s + oy)

    def proj_ll(lon, lat):
        return proj(*raw_xy(lon, lat))

    provinces = []
    total_pts = 0
    for props, rings in rings_by_prov:
        parts = []
        for ring in rings:
            pts = [proj(x, y) for x, y in ring]
            area = ring_area(pts)
            is_dokdo = props["code"] == "37" and min(p[0] for p in pts) > proj_ll(131.7, 37.2)[0]
            if area < MIN_AREA and not is_dokdo:
                continue
            # 닫힌 고리는 시작점과 가장 먼 점에서 둘로 나눠 단순화합니다.
            tol = TOL if not is_dokdo else 0.15
            far = max(range(len(pts)), key=lambda i: math.dist(pts[0], pts[i]))
            simp = dp(pts[: far + 1], tol)[:-1] + dp(pts[far:], tol)
            if len(simp) < 4:
                continue
            total_pts += len(simp)
            parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in simp[:-1]) + "Z")
        provinces.append(dict(code=props["code"], name=props["name"], en=props["name_eng"], d="".join(parts)))

    teams = []
    for t in TEAMS:
        x, y = proj_ll(t["lon"], t["lat"])
        teams.append({**t, "x": round(x, 1), "y": round(y, 1)})
    vx, vy = proj_ll(VENUE["lon"], VENUE["lat"])

    data = dict(width=W, height=H, provinces=provinces, teams=teams, venue=dict(x=round(vx, 1), y=round(vy, 1)),
                source="통계청(KOSTAT) 2018 센서스용 행정구역경계 · southkorea-maps")
    OUT.write_text("// 자동 생성: scripts/build_korea_map.py\nwindow.KOREA = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(f"provinces={len(provinces)} points={total_pts} bytes={OUT.stat().st_size}", file=sys.stderr)


if __name__ == "__main__":
    main()
