using WcsGateway.S7;
using WcsGateway.S7.Profiles;
using WcsGateway.S7.Transport;

namespace WcsGateway.Configuration;

public static class GatewayServices
{
    public static IServiceCollection AddS7Gateway(this IServiceCollection services, IConfiguration configuration, string webRoot)
    {
        var gateway = configuration.GetSection("Gateway").Get<GatewayOptions>() ?? new GatewayOptions();
        var polling = configuration.GetSection("S7").Get<S7PollingOptions>() ?? new S7PollingOptions();
        polling.Validate();
        var profiles = new S7ProfileRegistry(ResolvePath(gateway.ProfilesFile, webRoot));
        services.AddSingleton(profiles);
        services.AddSingleton(polling);
        services.AddSingleton(new ConnectionConfigStore(ResolvePath(gateway.ConfigFile, webRoot), profiles));
        services.AddSingleton<IPlcClientFactory, PlcClientFactory>();
        services.AddSingleton<S7ConnectionManager>();
        services.AddHostedService(provider => provider.GetRequiredService<S7ConnectionManager>());
        return services;
    }

    public static string ResolvePath(string path, string root) => !string.IsNullOrWhiteSpace(path)
        ? Path.GetFullPath(path, root) : throw new InvalidOperationException("配置文件路径不能为空。");

    public static string FindWebRoot()
    {
        foreach (var start in new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory })
        {
            var directory = new DirectoryInfo(start);
            for (var depth = 0; directory is not null && depth < 10; depth++, directory = directory.Parent)
                if (File.Exists(Path.Combine(directory.FullName, "index.html"))) return directory.FullName;
        }
        throw new InvalidOperationException("找不到包含 index.html 的项目目录。");
    }
}
