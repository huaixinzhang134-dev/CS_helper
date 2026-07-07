#!/usr/bin/env python3
"""Generate UPDATE team logo_url SQL from Navicat INSERT data."""
import re

# Full INSERT data from Navicat export (all 389 teams)
SQL_INSERT = """
INSERT INTO `team` VALUES (1, 'Nemiga', 'https://img-cdn.hltv.org/teamlogo/6ZPCm5r3XyGByXkFGiRnLh.png?ixlib=java-2.1.0&w=50&s=daa0328ebd0143763544b564610721e9', 'Europe', 3, 4, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (2, 'The MongolZ', 'https://img-cdn.hltv.org/teamlogo/4eJSkDQINNM6Tbs4WvLzkN.png?ixlib=java-2.1.0&w=50&s=d8c857ea47046f61eca695beab0d12ef', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (3, 'Sashi', 'https://img-cdn.hltv.org/teamlogo/xa5M31PECYUvHs6wlM9nzM.png?ixlib=java-2.1.0&w=50&s=e3f81637bc8dc9f9e3ab89a0a5c78d7d', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (4, 'OG', 'https://img-cdn.hltv.org/teamlogo/DfvLcyBWZPzMcRRqzxUfqL.png?ixlib=java-2.1.0&w=50&s=91d21a528d5bd893fb659abfe7077d40', 'Europe', 6, 6, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (5, 'Sangal', 'https://img-cdn.hltv.org/teamlogo/zPv_FeMF8CANC10Jz32P9l.png?ixlib=java-2.1.0&w=50&s=741a13d27b484b39f24cdc76dbf80568', 'Europe', 5, 6, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (6, 'Luminosity', 'https://img-cdn.hltv.org/teamlogo/HRSwDY9X42P2TiJqy1oeEJ.png?ixlib=java-2.1.0&w=50&s=987bcf053f274f928cf18f57f50076a6', 'Europe', 4, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (7, '100 Thieves', 'https://img-cdn.hltv.org/teamlogo/QdpX-_6C2wHMgv98VAE6il.png?ixlib=java-2.1.0&w=50&s=5f34e763e5f7c7d0408a8814f42d7a87', 'Europe', 7, 7, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (8, 'Natus Vincere', 'https://img-cdn.hltv.org/teamlogo/9iMirAi7ArBLNU8p3kqUTZ.svg?ixlib=java-2.1.0&s=4dd8635be16122656093ae9884675d0c', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (9, 'Gentle Mates', 'https://img-cdn.hltv.org/teamlogo/4vM_jGA-gAmOO3D19rxR1F.png?ixlib=java-2.1.0&w=50&s=e84a0026333c0d681a146ae08e1d318f', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (10, 'B8', 'https://img-cdn.hltv.org/teamlogo/O6nRWTCjUzBAR4pcOcrpSG.png?ixlib=java-2.1.0&w=50&s=305dde82e764725dab7e626800328137', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (11, 'THUNDER dOWNUNDER', 'https://img-cdn.hltv.org/teamlogo/bSRhbVtvK3S64DVmh5XIgi.png?ixlib=java-2.1.0&w=50&s=83a402b5b6e8c40009d10e796645e479', 'Asia', 6, 6, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (12, 'HEROIC', 'https://img-cdn.hltv.org/teamlogo/4S22uk_gnZTiQiI-hhH4yp.png?ixlib=java-2.1.0&w=50&s=3619ddf1d490573ab3dc261b8c2f3f6f', 'Europe', 5, 7, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (13, 'AM', 'https://img-cdn.hltv.org/teamlogo/WqSceeErZORFGoG8gJ4nLT.png?ixlib=java-2.1.0&w=50&s=a225f2cb39db0bf539158223cea243a2', 'Europe', 4, 4, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (14, 'ALGO', 'https://img-cdn.hltv.org/teamlogo/CuxdvjW3vWmW0NxP2OKiWd.png?ixlib=java-2.1.0&w=50&s=e545b3bdbec345377cb5ba6007528a12', 'Europe', 6, 6, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (15, 'ECSTATIC', 'https://img-cdn.hltv.org/teamlogo/yx_pWjWbW-2F5oF5nLHXc8.png?ixlib=java-2.1.0&w=50&s=fd7c45846bfcd3fe64ae4454979dbecd', 'Europe', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (16, 'Vitality', 'https://img-cdn.hltv.org/teamlogo/ogcHrcCdzRvxbYvAz04KAN.png?ixlib=java-2.1.0&w=50&s=e1f6019aa9f274ffe45a5e99c88dbc02', 'Europe', 4, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (17, 'BC.Game', 'https://img-cdn.hltv.org/teamlogo/Hwf-Y5nN-3qSvd0FZXOCh5.png?ixlib=java-2.1.0&w=50&s=a139a056665fc6d1534bd4d969ad2eaf', 'Europe', 8, 9, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (18, 'Legacy', 'https://img-cdn.hltv.org/teamlogo/RWbHH6RA8uGwJurGeLFvSr.png?ixlib=java-2.1.0&w=50&s=3d251032e156cab2f6df8c630ca29745', 'Americas', 5, 5, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (19, 'BetBoom', 'https://img-cdn.hltv.org/teamlogo/G4ZrdB0-q41USPd_z27IQA.png?ixlib=java-2.1.0&w=50&s=9c15ddf70f9c66399d4a47e0d8e93511', 'Europe', 6, 6, '2026-07-06 12:55:32');
INSERT INTO `team` VALUES (20, 'Alliance', 'https://img-cdn.hltv.org/teamlogo/xsWK0BtR26rN776qdnWFC1.png?ixlib=java-2.1.0&w=50&s=4aaf659c3855ebf08c78c157a0653352', 'Europe', 5, 5, '2026-07-06 12:55:32');
"""

count = 0
for line in SQL_INSERT.strip().split('\n'):
    if 'INSERT INTO' not in line:
        continue
    # Match: (id, 'name', 'logo_url', ...)
    m = re.search(r"VALUES\s*\(\d+,\s*'((?:[^']|'(?!,))*?)',\s*'((?:[^']|'(?!,))*?)'", line)
    if m:
        name = m.group(1).replace("'", "''")
        logo = m.group(2)
        print(f"UPDATE team SET logo_url = '{logo}' WHERE name = '{name}';")
        count += 1

print(f"\n-- 共 {count} 条记录已更新")
