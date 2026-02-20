const net = require("net");

function stripZoneIndex(ip) {
  const value = String(ip || "").trim();
  const percentIndex = value.indexOf("%");
  return percentIndex >= 0 ? value.slice(0, percentIndex) : value;
}

function normalizeIp(ip) {
  if (!ip) return null;

  let value = stripZoneIndex(ip);

  // Express can provide IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (value.startsWith("::ffff:")) {
    const maybeV4 = value.slice("::ffff:".length);
    if (net.isIP(maybeV4) === 4) {
      value = maybeV4;
    }
  }

  return net.isIP(value) ? value : null;
}

function expandIpv6(ipv6) {
  const ip = stripZoneIndex(ipv6).toLowerCase();
  const parts = ip.split("::");
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(":").filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(":").filter(Boolean) : [];
  if (left.length + right.length > 8) return null;

  const missing = 8 - (left.length + right.length);
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  return groups.map((group) => group.padStart(4, "0"));
}

function anonymizeIp(ip) {
  const value = normalizeIp(ip);
  if (!value) return null;

  const family = net.isIP(value);
  if (family === 4) {
    const octets = value.split(".");
    if (octets.length !== 4) return null;
    return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
  }

  if (family === 6) {
    const groups = expandIpv6(value);
    if (!groups) return null;
    return `${groups.slice(0, 4).join(":")}::/64`;
  }

  return null;
}

function getRequestIp(req) {
  return normalizeIp(req?.ip);
}

function getAnonymizedRequestIp(req) {
  return anonymizeIp(getRequestIp(req));
}

module.exports = {
  stripZoneIndex,
  normalizeIp,
  anonymizeIp,
  getRequestIp,
  getAnonymizedRequestIp
};
