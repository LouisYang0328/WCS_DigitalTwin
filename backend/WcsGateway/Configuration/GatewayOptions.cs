namespace WcsGateway.Configuration;

public sealed class GatewayOptions
{
    public string ListenUrl { get; set; } = "http://127.0.0.1:5080";
    public string ConfigFile { get; set; } = "backend/WcsGateway/data/connections.json";
    public string ProfilesFile { get; set; } = "backend/WcsGateway/config/plc-profiles.json";
}

public sealed class S7PollingOptions
{
    public int ConnectTimeoutMs { get; set; } = 5000;
    public int ReadTimeoutMs { get; set; } = 3000;
    public int RetryMinMs { get; set; } = 1000;
    public int RetryMaxMs { get; set; } = 15000;
    public int StaleAfterMs { get; set; } = 5000;

    public void Validate()
    {
        if (ConnectTimeoutMs is < 100 or > 120000 || ReadTimeoutMs is < 100 or > 120000 ||
            RetryMinMs is < 100 or > 120000 || RetryMaxMs < RetryMinMs || RetryMaxMs > 300000 ||
            StaleAfterMs is < 200 or > 600000)
            throw new InvalidOperationException("S7 超时、重试或过期时间配置无效，请检查 appsettings.json 的 S7 节点。");
    }

    public TimeSpan RetryDelay(int failures) => TimeSpan.FromMilliseconds(
        Math.Min(RetryMaxMs, RetryMinMs * Math.Pow(2, Math.Min(Math.Max(0, failures - 1), 16))));
}
