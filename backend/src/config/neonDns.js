const dns = require('dns');

/**
 * Resolves Neon hostnames reliably using public DNS (8.8.8.8, 1.1.1.1)
 * when local ISP/router DNS refuses to resolve Neon AWS CNAMEs.
 */
async function resolveNeonHost(hostname) {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err, address) => {
      if (!err && address) {
        return resolve({ host: hostname, servername: hostname });
      }

      // Local ISP/OS DNS failed: use public resolver
      const resolver = new dns.Resolver();
      resolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

      resolver.resolveCname(hostname, (cnameErr, cnames) => {
        const target = (cnames && cnames[0]) || hostname;
        resolver.resolve4(target, (ipErr, ips) => {
          if (!ipErr && ips && ips.length > 0) {
            return resolve({ host: ips[0], servername: hostname });
          }
          resolve({ host: hostname, servername: hostname });
        });
      });
    });
  });
}

module.exports = {
  resolveNeonHost
};
